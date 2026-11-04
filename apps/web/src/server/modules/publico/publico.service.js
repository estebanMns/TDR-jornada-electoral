import { setImmediate as cederEventLoop } from 'node:timers/promises';
import { SseConnection } from '../../core/transport/SseConnection.js';
import { TopicRegistry } from './topic-registry.js';
import { parsearEvento, compararId } from './eventos.js';

/**
 * Difusión pública (RF-4, RF-5, RF-6, RF-9). Dueña: Evelyn.
 *
 * 1. Un lector por instancia hace `XREAD BLOCK` sobre `ev:all` (canal GLOBAL:
 *    el flujo de escritura es pequeño, ~7.000 eventos en la jornada).
 * 2. Los eventos se acumulan por tópico durante una ventana (`ventanaMs`): por
 *    campo gana el último valor absoluto ⇒ un solo mensaje por tópico y ventana
 *    con el delta mínimo (solo los campos que cambiaron).
 * 3. Al cerrar la ventana, el mensaje se serializa UNA vez y se envía solo a
 *    los suscriptores de ese tópico, en lotes, cediendo el Event Loop entre lotes.
 *
 * Todos los mensajes de una misma ventana llevan como id el cursor del lector
 * (`hastaId`): cubren todos los eventos hasta ahí. Ese id es el `Last-Event-ID`
 * con el que el cliente vuelve tras desconectarse.
 */
export class PublicoService {
  #pendientes = new Map();
  #cursor = null;
  #activo = false;
  #lector = null;
  #temporizador = null;
  #pausado = false;

  /**
   * @param {{ repositorio: import('./publico.repository.js').PublicoRepository,
   *           politica: import('./backpressure-policy.js').BackpressurePolicy,
   *           metrics: import('../../core/metrics/MetricsRegistry.js').MetricsRegistry,
   *           logger: import('pino').Logger,
   *           ventanaMs?: number, lote?: number, maxPendientes?: number, maxEdadMs?: number }} deps
   */
  constructor({
    repositorio,
    politica,
    metrics,
    logger,
    ventanaMs = 2_000,
    lote = 500,
    maxPendientes = 2_000,
    maxEdadMs = 10 * 60_000,
  }) {
    Object.assign(this, { repositorio, politica, metrics, ventanaMs, lote, maxPendientes, maxEdadMs });
    this.logger = logger.child({ modulo: 'publico' });
    this.registro = new TopicRegistry();
    politica.alDrenar = (conexion) => this.#reenviarFotografias(conexion);
    metrics.gauge('publico_topicos', () => this.registro.topicos());
  }

  iniciar() {
    if (this.#activo) return;
    this.#activo = true;
    this.#lector = this.#bucleLectura();
    this.#programarVentana();
  }

  /** Último evento de `ev:all` leído por esta instancia. */
  get cursor() {
    return this.#cursor;
  }

  async detener() {
    this.#activo = false;
    clearTimeout(this.#temporizador);
    await this.#lector?.catch(() => {});
  }

  // ---------------------------------------------------------------- conexiones

  /**
   * Alta de un cliente: suscribe sus tópicos y le envía el estado inicial
   * (detalle de lo que se perdió, o fotografía completa). Mientras se calcula,
   * lo que llegue en vivo se guarda en su búfer para no abrir un hueco.
   * @param {import('../../core/transport/ClientConnection.js').ClientConnection} conexion
   * @param {string[]} topicos
   * @param {string|null} ultimoId `Last-Event-ID` del cliente
   */
  async conectar(conexion, topicos, ultimoId) {
    conexion.publico = { topicos, desde: null, bufer: [], atrasadaDesde: null };
    for (const topico of topicos) this.registro.add(topico, conexion);
    conexion.onClose(() => this.registro.removeConnection(conexion));

    if (this.#pausado) {
      conexion.send(this.#mensajeEstado(true));
      conexion.publico.necesitaFotografia = true;
      conexion.publico.desde = '0-0';
      return;
    }
    const inicial = await this.#estadoInicial(topicos, ultimoId);
    if (!conexion.abierta) return;
    conexion.send(inicial.texto);
    this.metrics.inc(inicial.tipo === 'snapshot' ? 'publico_fotografias' : 'publico_continuidades');
    if (ultimoId) this.metrics.inc('publico_reconexiones');

    const { bufer } = conexion.publico;
    conexion.publico.desde = inicial.hastaId;
    conexion.publico.bufer = [];
    for (const { hastaId, texto } of bufer) {
      if (compararId(hastaId, inicial.hastaId) > 0) conexion.send(texto);
    }
  }

  /**
   * RF-6: si el cliente trae un id reciente, se le manda UN delta con lo que
   * pasó en su ausencia; si no trae id, si el id ya salió del historial, si se
   * perdió demasiado o hace demasiado, se le manda la fotografía completa.
   */
  async #estadoInicial(topicos, ultimoId) {
    if (ultimoId && /^\d+-\d+$/.test(ultimoId)) {
      const edad = Date.now() - Number(ultimoId.split('-')[0]);
      const primero = await this.repositorio.primerId();
      if (edad <= this.maxEdadMs && primero && compararId(ultimoId, primero) >= 0) {
        const eventos = await this.repositorio.desde(ultimoId, this.maxPendientes + 1);
        if (eventos.length <= this.maxPendientes) {
          const hastaId = eventos.at(-1)?.[0] ?? ultimoId;
          const porTopico = {};
          const motivos = [];
          for (const crudo of eventos) {
            const evento = parsearEvento(crudo);
            for (const topico of topicos) {
              const campos = evento.porTopico[topico];
              if (!campos) continue;
              Object.assign((porTopico[topico] ??= {}), campos);
              if (evento.motivo) motivos.push(evento.motivo);
            }
          }
          const texto = topicos
            .map((topico) =>
              SseConnection.formatear({
                id: hastaId,
                evento: 'delta',
                datos: { topico, cambios: porTopico[topico] ?? {}, motivos: motivos.slice(-20), hastaId },
              }),
            )
            .join('');
          return { tipo: 'delta', hastaId, texto };
        }
      }
    }
    const fotos = await Promise.all(topicos.map((t) => this.repositorio.fotografia(t)));
    // Todas las fotografías se leen casi a la vez; se usa el id menor para no saltarse nada.
    const hastaId = fotos.map((f) => f.hastaId).sort(compararId)[0];
    const texto = fotos
      .map((foto) => SseConnection.formatear({ id: hastaId, evento: 'snapshot', datos: { ...foto, hastaId } }))
      .join('');
    return { tipo: 'snapshot', hastaId, texto };
  }

  /** RF-9: el cliente lento se puso al día → fotografía actual de sus tópicos. */
  async #reenviarFotografias(conexion) {
    const estado = await this.#estadoInicial(conexion.publico.topicos, null);
    if (!conexion.abierta) return;
    conexion.send(estado.texto);
    conexion.publico.desde = estado.hastaId;
    this.metrics.inc('publico_fotografias_por_contrapresion');
  }

  // ---------------------------------------------------------------- lectura

  async #bucleLectura() {
    while (this.#activo) {
      try {
        this.#cursor ??= await this.repositorio.ultimoId();
        const filas = await this.repositorio.leer(this.#cursor);
        for (const fila of filas) this.#acumular(parsearEvento(fila));
      } catch (err) {
        this.logger.debug({ err: err.message }, 'lectura de ev:all falló; reintento');
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  #acumular(evento) {
    this.#cursor = evento.id;
    this.metrics.inc('publico_eventos');
    // Cifra ingenua: cada acta enviada a cada cliente conectado a la instancia.
    this.metrics.inc('publico_mensajes_ingenuos', this.registro.totalConexiones());
    for (const [topico, campos] of Object.entries(evento.porTopico)) {
      const pendiente = this.#pendientes.get(topico) ?? { cambios: {}, motivos: [], tsRxMin: evento.tsRx };
      Object.assign(pendiente.cambios, campos);
      if (evento.motivo) pendiente.motivos.push(evento.motivo);
      pendiente.tsRxMin = Math.min(pendiente.tsRxMin, evento.tsRx);
      this.#pendientes.set(topico, pendiente);
    }
  }

  // ---------------------------------------------------------------- fan-out

  #programarVentana() {
    if (!this.#activo) return;
    this.#temporizador = setTimeout(async () => {
      try {
        await this.publicarVentana();
      } catch (err) {
        this.logger.warn({ err }, 'fan-out de la ventana falló');
      } finally {
        this.#programarVentana();
      }
    }, this.ventanaMs);
    this.#temporizador.unref?.();
  }

  /** Cierra la ventana actual y envía un mensaje por tópico a sus suscriptores. */
  async publicarVentana() {
    if (this.#pendientes.size === 0) return;
    const hastaId = this.#cursor;
    const ventana = this.#pendientes;
    this.#pendientes = new Map();
    const inicio = performance.now();

    for (const [topico, { cambios, motivos, tsRxMin }] of ventana) {
      const destinos = [...this.registro.subscribers(topico)];
      if (destinos.length === 0) continue;
      const texto = SseConnection.formatear({
        id: hastaId,
        evento: 'delta',
        datos: { topico, cambios, motivos: motivos.slice(-20), hastaId, tsRx: tsRxMin },
      });
      let enviados = 0;
      for (let i = 0; i < destinos.length; i += this.lote) {
        for (const conexion of destinos.slice(i, i + this.lote)) {
          enviados += this.#entregar(conexion, hastaId, texto);
        }
        if (i + this.lote < destinos.length) await cederEventLoop(); // RF-4
      }
      this.metrics.inc('publico_mensajes_reales', enviados);
      this.metrics.observe('publico_latencia_ms', Date.now() - tsRxMin); // recepción → publicación
    }
    this.metrics.observe('publico_fanout_ms', performance.now() - inicio);
  }

  /** @returns {0|1} */
  #entregar(conexion, hastaId, texto) {
    const estado = conexion.publico;
    if (!estado || !conexion.abierta) return 0;
    if (estado.desde === null) {
      estado.bufer.push({ hastaId, texto }); // todavía calculando su estado inicial
      return 0;
    }
    if (compararId(estado.desde, hastaId) >= 0) return 0;
    return this.politica.enviar(conexion, texto) ? 1 : 0;
  }

  // ---------------------------------------------------------------- degradación

  /** RF-10: Redis caído → todos ven "Actualizaciones pausadas"; al volver, se reanuda. */
  cambioDeRedis(estadoRedis) {
    const pausado = estadoRedis !== 'ok';
    if (pausado === this.#pausado) return;
    this.#pausado = pausado;
    const texto = this.#mensajeEstado(pausado);
    for (const conexion of this.registro.todas()) {
      conexion.send(texto);
      if (!pausado && conexion.publico?.necesitaFotografia) {
        conexion.publico.necesitaFotografia = false;
        this.#reenviarFotografias(conexion).catch(() => {});
      }
    }
  }

  #mensajeEstado(pausado) {
    return SseConnection.formatear({ evento: 'estado', datos: { pausado, desde: Date.now() } });
  }

  /** Comentario `: ping` a todos los clientes (mantiene viva la conexión en proxies). */
  async ping() {
    let i = 0;
    for (const conexion of this.registro.todas()) {
      conexion.comentario?.('ping');
      if (++i % this.lote === 0) await cederEventLoop();
    }
  }
}
