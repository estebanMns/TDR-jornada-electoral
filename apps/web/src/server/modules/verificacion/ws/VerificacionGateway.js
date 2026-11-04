import { ROLES_VERIFICACION } from '@preconteo/shared/roles';
import { mensajeClienteSchema, MensajeServidor as M } from '@preconteo/shared/schemas/verificacion';
import { WsConnection } from '../../../core/transport/WsConnection.js';
import { TareaPeriodica } from '../../../core/tasks/TareaPeriodica.js';
import { RedisNoDisponibleError } from '../../../core/errors/RedisNoDisponibleError.js';
import { EstadoRedis } from '../../../core/redis/RedisGateway.js';
import { ErrorVerificacion, CodigoErrorVerificacion as Codigo } from '../verificacion.errores.js';
import { SesionVerificacion } from './SesionVerificacion.js';
import { NotificadorPresencia } from './NotificadorPresencia.js';

export const RUTA_WS_VERIFICACION = '/ws/verificacion';

/**
 * Gateway WebSocket de la consola de auditoría (GENERAL §7.4).
 *
 * Responsabilidades: autenticar el upgrade, traducir mensajes ↔ comandos, y
 * reenviar a los sockets LOCALES lo que llega por `ch:verif` desde cualquier
 * instancia (así un caso tomado en app3 se ve al instante en app7).
 * La lógica de negocio vive en el servicio; los comandos, en ComandosVerificacion.
 */
export class VerificacionGateway {
  /** @type {Set<SesionVerificacion>} */
  #sesiones = new Set();
  #notificador;

  /**
   * @param {{
   *   auth: import('../../../core/auth/AuthService.js').AuthService,
   *   comandos: import('./ComandosVerificacion.js').ComandosVerificacion,
   *   presencia: import('../presencia.service.js').PresenciaService,
   *   canalVerificacion: import('../../../core/redis/CanalRedis.js').CanalRedis,
   *   canalPresencia: import('../../../core/redis/CanalRedis.js').CanalRedis,
   *   conexiones: import('../../../core/transport/ConnectionRegistry.js').ConnectionRegistry,
   *   redis: import('../../../core/redis/RedisGateway.js').RedisGateway,
   *   metrics: import('../../../core/metrics/MetricsRegistry.js').MetricsRegistry,
   *   logger: import('pino').Logger,
   * }} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.logger = deps.logger.child({ componente: 'ws-verificacion' });
    this.#notificador = new NotificadorPresencia({
      presencia: deps.presencia,
      coordinadores: () => this.#coordinadores(),
      logger: this.logger,
    });
  }

  /**
   * @param {import('../../../core/realtime/RealtimeRouter.js').RealtimeRouter} router
   * @param {import('../../../core/tasks/Planificador.js').Planificador} tareas
   */
  registrar(router, tareas) {
    router.ws(RUTA_WS_VERIFICACION, {
      autenticar: (req) => this.#autenticar(req),
      conectar: (ws, _req, usuario) => this.#conectar(ws, usuario),
    });

    this.canalVerificacion.escuchar((mensaje) => this.#difundir(mensaje));
    this.canalPresencia.escuchar(() => this.#notificador.programar());
    this.redis.on('cambioEstado', (estado) => this.#alCambiarRedis(estado));
    this.metrics.gauge('ws_verificacion', () => this.#sesiones.size);

    tareas.agregar(
      new TareaPeriodica({
        nombre: 'ws-verificacion-ping',
        intervaloMs: 30_000,
        logger: this.logger,
        ejecutar: () => this.#sesiones.forEach((s) => s.conexion.comprobarVida()),
      }),
    );
    tareas.agregar(
      new TareaPeriodica({
        nombre: 'presencia-coordinadores',
        intervaloMs: 5_000,
        logger: this.logger,
        ejecutar: () => this.redis.disponible() && this.#notificador.enviar(),
      }),
    );
  }

  async #autenticar(req) {
    const usuario = await this.auth.usuarioDeIncomingMessage(req, { permitirQuery: true });
    return this.auth.autorizar(usuario, ROLES_VERIFICACION);
  }

  async #conectar(ws, usuario) {
    const conexion = this.conexiones.agregar(new WsConnection(ws));
    const sesion = new SesionVerificacion(conexion, usuario);
    this.#sesiones.add(sesion);

    conexion.onMessage((texto) => this.#alMensaje(sesion, texto));
    ws.once('close', (codigo) => this.#alCerrar(sesion, codigo));

    sesion.enviar({ tipo: M.ESTADO, redis: this.redis.estado() });
    await this.#ejecutar(sesion, () => this.comandos.hola(sesion));
    if (sesion.esCoordinador)
      await this.#ejecutar(sesion, () => this.#notificador.enviar([sesion]));
  }

  #alMensaje(sesion, texto) {
    let mensaje;
    try {
      mensaje = mensajeClienteSchema.parse(JSON.parse(texto));
    } catch {
      sesion.enviar({ tipo: M.ERROR, codigo: Codigo.MENSAJE_INVALIDO });
      return;
    }
    this.metrics.inc('ws_verificacion_mensajes');
    return this.#ejecutar(sesion, () => this.comandos[mensaje.tipo](sesion, mensaje), mensaje.acta);
  }

  /** Traduce errores a `error {codigo, acta}`; nunca deja una acción sin respuesta. */
  async #ejecutar(sesion, accion, acta) {
    try {
      await accion();
    } catch (err) {
      if (ErrorVerificacion.es(err)) {
        sesion.enviar({ tipo: M.ERROR, codigo: err.codigo, acta: err.acta ?? acta });
      } else if (RedisNoDisponibleError.es(err)) {
        sesion.enviar({ tipo: M.ERROR, codigo: Codigo.REDIS_NO_DISPONIBLE, acta });
      } else {
        this.logger.error({ err, sub: sesion.usuario.sub }, 'error procesando mensaje');
        sesion.enviar({ tipo: M.ERROR, codigo: 'ERROR_INTERNO', acta });
      }
    }
  }

  async #alCerrar(sesion, codigo) {
    this.#sesiones.delete(sesion);
    const limpio = codigo === 1000 || codigo === 1001;
    const sigueConectado = [...this.#sesiones].some((s) => s.usuario.sub === sesion.usuario.sub);
    if (limpio && !sigueConectado) {
      // El caso NO se suelta aquí: una recarga de página cierra con 1001 y debe
      // poder retomarlo con su token. Si no vuelve, el lease expira (≤ 30 s).
      await this.presencia.salir(sesion.usuario.sub).catch(() => {});
    }
  }

  /** Un mensaje de `ch:verif` (de cualquier instancia) → todos los sockets locales. */
  #difundir(mensaje) {
    const texto = JSON.stringify(mensaje);
    for (const sesion of this.#sesiones) sesion.enviarTexto(texto);
  }

  async #alCambiarRedis(estado) {
    this.#difundir({ tipo: M.ESTADO, redis: estado });
    if (estado !== EstadoRedis.OK) return;
    // Pub/Sub no tiene memoria: tras un corte se reenvía la fotografía completa.
    for (const sesion of this.#sesiones)
      await this.#ejecutar(sesion, () => this.comandos.hola(sesion));
  }

  *#coordinadores() {
    for (const sesion of this.#sesiones) if (sesion.esCoordinador) yield sesion;
  }
}
