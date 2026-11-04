import { Rol } from '@preconteo/shared/roles';
import { SseConnection } from '../../core/transport/SseConnection.js';
import { TareaPeriodica } from '../../core/tasks/TareaPeriodica.js';

export const RUTA_OPS_STREAM = '/api/ops/stream';

/**
 * `GET /api/ops/stream` (ADMIN): cada 2 s el agregado de métricas por SSE.
 * Un solo temporizador por instancia; el mensaje se serializa una vez y se
 * envía a todos los tableros abiertos (no un ciclo por conexión).
 */
export class OpsStream {
  /** @type {Set<SseConnection>} */
  #tableros = new Set();

  /**
   * @param {{ servicio: import('./ops.service.js').OpsService,
   *           auth: import('../../core/auth/AuthService.js').AuthService,
   *           redis: import('../../core/redis/RedisGateway.js').RedisGateway,
   *           conexiones: import('../../core/transport/ConnectionRegistry.js').ConnectionRegistry,
   *           logger: import('pino').Logger, intervaloMs?: number }} deps
   */
  constructor({ servicio, auth, redis, conexiones, logger, intervaloMs = 2_000 }) {
    Object.assign(this, { servicio, auth, redis, conexiones, logger });
    this.tarea = new TareaPeriodica({
      nombre: 'ops-stream',
      intervaloMs,
      logger,
      ejecutar: () => this.#emitir(),
    });
  }

  registrar(router, tareas) {
    router.http(RUTA_OPS_STREAM, (req, res) => this.#abrir(req, res));
    tareas.agregar(this.tarea);
  }

  async #abrir(req, res) {
    const usuario = await this.auth.usuarioDeIncomingMessage(req);
    this.auth.autorizar(usuario, [Rol.ADMIN]); // lanza 401/403 → RealtimeRouter responde

    const conexion = this.conexiones.agregar(new SseConnection(res));
    this.#tableros.add(conexion);
    conexion.onClose(() => this.#tableros.delete(conexion));
    await this.#emitir([conexion]);
  }

  /** @param {Iterable<SseConnection>} [destinos] */
  async #emitir(destinos = this.#tableros) {
    const lista = [...destinos];
    if (lista.length === 0) return;
    const texto = await this.#mensaje();
    for (const conexion of lista) conexion.send(texto);
  }

  async #mensaje() {
    if (!this.redis.disponible()) {
      return SseConnection.formatear({
        evento: 'estado',
        datos: { redis: 'degradado', ts: Date.now() },
      });
    }
    return SseConnection.formatear({ evento: 'metricas', datos: await this.servicio.agregado() });
  }
}
