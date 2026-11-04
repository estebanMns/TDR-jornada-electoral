import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ClientConnection } from '../../src/server/core/transport/ClientConnection.js';
import { MetricsRegistry } from '../../src/server/core/metrics/MetricsRegistry.js';
import { cargarScriptsLua } from '../../src/server/core/redis/cargarScriptsLua.js';
import { PublicoRepository } from '../../src/server/modules/publico/publico.repository.js';
import { PublicoService } from '../../src/server/modules/publico/publico.service.js';
import { BackpressurePolicy } from '../../src/server/modules/publico/backpressure-policy.js';
import { compararId } from '../../src/server/modules/publico/eventos.js';
import { crearRedisDePrueba, esperarHasta, loggerSilencioso } from '../helpers/redisDePrueba.js';

const LUA = fileURLToPath(new URL('../../src/server/modules/publico/lua/', import.meta.url));

/** Conexión de prueba: guarda lo recibido y simula un socket lento. */
class ConexionFalsa extends ClientConnection {
  recibido = '';
  pendientes = 0;
  /** @param {{ costoUs?: number, guardar?: boolean }} [opciones] costo simulado de un `res.write` real */
  constructor({ costoUs = 0, guardar = true } = {}) {
    super('sse');
    this.costoUs = costoUs;
    this.guardar = guardar;
  }
  send(texto) {
    if (!this.abierta) return false;
    if (this.costoUs) {
      const fin = performance.now() + this.costoUs / 1000;
      while (performance.now() < fin);
    }
    if (this.guardar) this.recibido += texto;
    return true;
  }
  bufferedBytes() {
    return this.pendientes;
  }
  comentario() {}
  close(motivo) {
    this.motivoCierre = motivo;
    this.marcarCerrada(motivo);
  }
  drenar() {
    this.pendientes = 0;
    this.emitirDrain();
  }
}

/** Cliente que aplica los eventos SSE recibidos como lo hace la página pública. */
function estadoDelCliente(textoSse) {
  const porTopico = {};
  const ultimo = {};
  let ultimoId = null;
  for (const bloque of textoSse.split('\n\n')) {
    const id = /^id: (.+)$/m.exec(bloque)?.[1];
    const evento = /^event: (.+)$/m.exec(bloque)?.[1];
    const datos = /^data: (.+)$/m.exec(bloque)?.[1];
    if (!datos || !['delta', 'snapshot'].includes(evento)) continue;
    const { topico, cambios, totales } = JSON.parse(datos);
    if (ultimo[topico] && compararId(id, ultimo[topico]) <= 0) continue;
    ultimo[topico] = id;
    ultimoId = id;
    porTopico[topico] = evento === 'snapshot' ? { ...totales } : { ...porTopico[topico], ...cambios };
  }
  return { porTopico, ultimoId };
}

/**
 * Publica un acta como lo hace `apply_acta.lua`: suma en tot:* y escribe en ev:all
 * los valores absolutos nuevos de los campos que cambiaron.
 */
async function publicarActa(r, { estacion, mun, votos, tipo = 'APPLIED', acta = 'E14-x' }) {
  const abs = {};
  for (const topico of [`station:${estacion}`, `mun:${mun}`, 'dep']) {
    abs[topico] = {};
    for (const [campo, delta] of Object.entries({ ...votos, _reported: tipo === 'APPLIED' ? 1 : 0 })) {
      if (delta === 0) continue;
      abs[topico][campo] = await r.hincrby(`tot:${topico}`, campo, delta);
    }
  }
  return r.xadd('ev:all', '*', 'acta', acta, 'type', tipo, 'tsRx', String(Date.now()), 'abs', JSON.stringify(abs));
}

describe('Difusión pública (Redis real)', () => {
  let redis;
  let servicio;
  let metrics;

  async function crearServicio(opciones = {}) {
    redis.definirScripts(cargarScriptsLua(LUA, { snapshotPublico: { archivo: 'snapshot.lua', numeroClaves: 3 } }));
    metrics = new MetricsRegistry();
    const repositorio = new PublicoRepository({ redis, lector: redis.crearConexionBloqueante('test-xread') });
    servicio = new PublicoService({
      repositorio,
      politica: new BackpressurePolicy({ metrics, ...opciones.politica }),
      metrics,
      logger: loggerSilencioso,
      ventanaMs: 60_000, // las ventanas se cierran a mano con publicarVentana()
      ...opciones.servicio,
    });
    servicio.iniciar();
    await esperarHasta(() => servicio.cursor !== null, 3_000);
    return servicio;
  }

  /** Espera a que el lector haya consumido hasta `id`. */
  const leidoHasta = (id) => esperarHasta(() => servicio.cursor && compararId(servicio.cursor, id) >= 0, 3_000);

  beforeEach(async () => {
    redis = await crearRedisDePrueba();
    await redis.comandos.set('cat:n:dep', '6400');
    await redis.comandos.set('cat:n:mun:1', '200');
  });

  afterEach(async () => {
    await servicio?.detener();
    await redis.detener();
  });

  it('RF-6: un cliente que se desconecta y vuelve con su id queda igual al que nunca se fue', async () => {
    await crearServicio();
    const r = redis.comandos;
    const siempre = new ConexionFalsa();
    const vuelve = new ConexionFalsa();
    await servicio.conectar(siempre, ['dep', 'mun:1'], null);
    await servicio.conectar(vuelve, ['dep', 'mun:1'], null);

    let id = await publicarActa(r, { estacion: 1, mun: 1, votos: { C1: 100, C2: 50 } });
    await leidoHasta(id);
    await servicio.publicarVentana();

    // `vuelve` se desconecta; mientras tanto llegan más actas, incluida una corrección que baja C1.
    const { ultimoId } = estadoDelCliente(vuelve.recibido);
    vuelve.close('red');
    await publicarActa(r, { estacion: 2, mun: 1, votos: { C1: 30, C3: 7 } });
    id = await publicarActa(r, { estacion: 1, mun: 1, votos: { C1: -10 }, tipo: 'CORRECTION' });
    await leidoHasta(id);
    await servicio.publicarVentana();

    const regresa = new ConexionFalsa();
    await servicio.conectar(regresa, ['dep', 'mun:1'], ultimoId);

    const esperado = estadoDelCliente(siempre.recibido).porTopico;
    const recuperado = estadoDelCliente(vuelve.recibido + regresa.recibido).porTopico;
    expect(recuperado).toEqual(esperado);
    expect(esperado.dep).toMatchObject({ C1: 120, C2: 50, C3: 7 });
    // Recibió el detalle de lo perdido (delta), no una fotografía completa.
    expect(regresa.recibido).toContain('event: delta');
    expect(regresa.recibido).not.toContain('event: snapshot');
  });

  it('RF-6: sin id, o con un id que ya salió del historial, recibe la fotografía completa', async () => {
    await crearServicio();
    const r = redis.comandos;
    await publicarActa(r, { estacion: 1, mun: 1, votos: { C1: 40 } });

    const nuevo = new ConexionFalsa();
    await servicio.conectar(nuevo, ['mun:1'], null);
    const viejo = new ConexionFalsa();
    await servicio.conectar(viejo, ['mun:1'], '1-0');

    for (const conexion of [nuevo, viejo]) {
      expect(conexion.recibido).toContain('event: snapshot');
      const snapshot = JSON.parse(/^data: (.+)$/m.exec(conexion.recibido.split('event: snapshot')[1])[1]);
      expect(snapshot.totales.C1).toBe(40);
      expect(snapshot.mesas).toEqual({ informadas: 1, total: 200 });
    }
  });

  it('RF-4/RF-5: un mensaje por tópico y ventana, solo a sus suscriptores, y muchos menos que la cifra ingenua', async () => {
    await crearServicio();
    const r = redis.comandos;
    const deMun1 = Array.from({ length: 10 }, () => new ConexionFalsa());
    const deMun2 = Array.from({ length: 10 }, () => new ConexionFalsa());
    for (const c of deMun1) await servicio.conectar(c, ['mun:1'], null);
    for (const c of deMun2) await servicio.conectar(c, ['mun:2'], null);
    const antes = deMun2[0].recibido;

    let id;
    for (let i = 0; i < 30; i++) id = await publicarActa(r, { estacion: 1, mun: 1, votos: { C1: 1 } });
    await leidoHasta(id);
    await servicio.publicarVentana();

    const deltas = deMun1[0].recibido.split('event: delta').length - 1;
    expect(deltas).toBe(1); // 30 actas → 1 mensaje en la ventana
    expect(deMun2[0].recibido).toBe(antes); // mun:2 no recibe nada de mun:1
    const { contadores } = metrics.fotografia();
    expect(contadores.publico_mensajes_reales.total).toBe(10);
    expect(contadores.publico_mensajes_ingenuos.total).toBe(30 * 20);
  });

  it('RF-4: el fan-out a 50.000 conexiones en lotes mantiene acotado el retraso del Event Loop', async () => {
    const medir = async (lote) => {
      await servicio?.detener();
      await redis.comandos.flushdb();
      await crearServicio({ servicio: { lote } });
      const conexiones = Array.from({ length: 50_000 }, () => new ConexionFalsa({ costoUs: 10, guardar: false }));
      for (const c of conexiones) {
        c.publico = { topicos: ['dep'], desde: '0-0', bufer: [], atrasadaDesde: null };
        servicio.registro.add('dep', c);
      }
      const id = await publicarActa(redis.comandos, { estacion: 1, mun: 1, votos: { C1: 1 } });
      await leidoHasta(id);
      const h = monitorEventLoopDelay({ resolution: 1 });
      h.enable();
      await new Promise((r) => setTimeout(r, 30)); // que el monitor ya esté muestreando
      await servicio.publicarVentana();
      await new Promise((r) => setTimeout(r, 20));
      h.disable();
      return h.max / 1e6;
    };
    const sinLotes = await medir(Number.MAX_SAFE_INTEGER);
    const conLotes = await medir(500);
    console.log(`retraso máximo del Event Loop: sin lotes ${sinLotes.toFixed(1)} ms, con lotes ${conLotes.toFixed(1)} ms`);
    expect(conLotes).toBeLessThan(sinLotes / 5);
    expect(conLotes).toBeLessThan(50);
  });

  it('RF-9: un cliente lento deja de recibir detalle, se pone al día con una fotografía y si no lee se desconecta', async () => {
    await crearServicio();
    const r = redis.comandos;
    const lento = new ConexionFalsa();
    await servicio.conectar(lento, ['dep'], null);

    lento.pendientes = 100 * 1024; // por encima de 64 KB
    let id = await publicarActa(r, { estacion: 1, mun: 1, votos: { C1: 5 } });
    await leidoHasta(id);
    const recibidoAntes = lento.recibido;
    await servicio.publicarVentana();
    expect(lento.recibido).toBe(recibidoAntes); // no se le envió el delta

    lento.drenar(); // se puso al día
    await esperarHasta(() => lento.recibido.split('event: snapshot').length > 2, 2_000);
    expect(estadoDelCliente(lento.recibido).porTopico.dep.C1).toBe(5);

    lento.pendientes = 600 * 1024; // por encima de 512 KB
    id = await publicarActa(r, { estacion: 1, mun: 1, votos: { C1: 1 } });
    await leidoHasta(id);
    await servicio.publicarVentana();
    expect(lento.abierta).toBe(false);
    expect(lento.motivoCierre).toBe('cliente_lento');
  });
});
