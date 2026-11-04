import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { RedisNoDisponibleError } from '../errors/RedisNoDisponibleError.js';
import { TareaPeriodica } from '../tasks/TareaPeriodica.js';

export const EstadoRedis = Object.freeze({ OK: 'ok', DEGRADADO: 'degradado' });

/** Backoff exponencial con full jitter para la reconexión (GENERAL §9.4). */
const estrategiaReconexion = (intento) =>
  Math.round(Math.random() * Math.min(5_000, 100 * 2 ** intento));

/**
 * Punto único de acceso a Redis (patrón Gateway + circuit breaker simple).
 *
 * - `comandos`: conexión para comandos normales, falla rápido (sin cola offline,
 *   timeout de 500 ms, un reintento).
 * - `crearConexionBloqueante()`: para XREAD BLOCK / XREADGROUP (sin commandTimeout).
 * - `crearConexionSuscriptor()`: para Pub/Sub.
 * - `estado()`: `ok | degradado`, vigilado con PING cada segundo y con los eventos
 *   de la conexión. Emite `cambioEstado` (nuevo, anterior) al cambiar.
 */
export class RedisGateway extends EventEmitter {
  #opcionesBase;
  #comandos;
  #extras = new Set();
  #estado = EstadoRedis.DEGRADADO;
  #vigilante;
  #logger;

  /**
   * @param {{ url: string, password?: string, logger: import('pino').Logger, intervaloPingMs?: number }} opciones
   */
  constructor({ url, password, logger, intervaloPingMs = 1_000 }) {
    super();
    this.#logger = logger.child({ componente: 'redis' });
    this.#opcionesBase = { url, password, retryStrategy: estrategiaReconexion };
    this.#comandos = this.#crear({
      enableOfflineQueue: false,
      commandTimeout: 500,
      maxRetriesPerRequest: 1,
      connectionName: 'comandos',
    });
    this.#comandos.on('ready', () => this.#cambiarEstado(EstadoRedis.OK));
    for (const evento of ['error', 'close', 'end']) {
      this.#comandos.on(evento, (err) => {
        if (err) this.#logger.debug({ err: err.message }, 'evento de conexión redis');
        this.#cambiarEstado(EstadoRedis.DEGRADADO);
      });
    }
    this.#vigilante = new TareaPeriodica({
      nombre: 'redis-ping',
      intervaloMs: intervaloPingMs,
      logger: this.#logger,
      ejecutar: () => this.#verificarConPing(),
    });
  }

  /** Cliente ioredis para comandos (también ejecuta los scripts Lua definidos). */
  get comandos() {
    return this.#comandos;
  }

  /** @returns {'ok'|'degradado'} */
  estado() {
    return this.#estado;
  }

  disponible() {
    return this.#estado === EstadoRedis.OK;
  }

  /** Lanza `RedisNoDisponibleError` si Redis está degradado (fallar rápido). */
  asegurarDisponible() {
    if (!this.disponible()) throw new RedisNoDisponibleError();
  }

  /**
   * Ejecuta una operación contra Redis traduciendo cualquier fallo de conexión
   * a `RedisNoDisponibleError`, para que las capas superiores no conozcan ioredis.
   * @template T
   * @param {(redis: Redis) => Promise<T>} operacion
   * @returns {Promise<T>}
   */
  async ejecutar(operacion) {
    this.asegurarDisponible();
    try {
      return await operacion(this.#comandos);
    } catch (err) {
      if (esErrorDeConexion(err)) {
        this.#cambiarEstado(EstadoRedis.DEGRADADO);
        throw new RedisNoDisponibleError(err);
      }
      throw err;
    }
  }

  /**
   * Registra scripts Lua con `defineCommand` (EVALSHA con respaldo a EVAL).
   * @param {Array<{ nombre: string, numeroClaves: number, lua: string }>} scripts
   */
  definirScripts(scripts) {
    for (const { nombre, numeroClaves, lua } of scripts) {
      if (typeof this.#comandos[nombre] === 'function') continue; // idempotente
      this.#comandos.defineCommand(nombre, { numberOfKeys: numeroClaves, lua });
    }
  }

  /** Conexión dedicada para comandos bloqueantes (XREAD BLOCK, XREADGROUP). */
  crearConexionBloqueante(nombre = 'bloqueante') {
    return this.#registrarExtra(
      this.#crear({ enableOfflineQueue: false, maxRetriesPerRequest: 1, connectionName: nombre }),
    );
  }

  /** Conexión dedicada para SUBSCRIBE. */
  crearConexionSuscriptor(nombre = 'suscriptor') {
    return this.#registrarExtra(
      this.#crear({ enableOfflineQueue: false, autoResubscribe: false, connectionName: nombre }),
    );
  }

  iniciar() {
    this.#vigilante.iniciar();
  }

  async detener() {
    this.#vigilante.detener();
    const conexiones = [this.#comandos, ...this.#extras];
    await Promise.allSettled(conexiones.map((c) => c.quit().catch(() => c.disconnect())));
  }

  async #verificarConPing() {
    try {
      await this.#comandos.ping();
      this.#cambiarEstado(EstadoRedis.OK);
    } catch {
      this.#cambiarEstado(EstadoRedis.DEGRADADO);
    }
  }

  #cambiarEstado(nuevo) {
    const anterior = this.#estado;
    if (anterior === nuevo) return;
    this.#estado = nuevo;
    const log = nuevo === EstadoRedis.OK ? 'info' : 'warn';
    this.#logger[log]({ anterior, nuevo }, 'cambio de estado de Redis');
    this.emit('cambioEstado', nuevo, anterior);
  }

  #crear(opciones) {
    const { url, ...resto } = this.#opcionesBase;
    return new Redis(url, { ...resto, ...opciones });
  }

  #registrarExtra(conexion) {
    this.#extras.add(conexion);
    conexion.on('error', (err) =>
      this.#logger.debug({ err: err.message }, 'error en conexión extra'),
    );
    conexion.once('end', () => this.#extras.delete(conexion));
    return conexion;
  }
}

function esErrorDeConexion(err) {
  const mensaje = String(err?.message ?? '');
  return (
    err?.name === 'MaxRetriesPerRequestError' ||
    /Command timed out|Stream isn't writeable|Connection is closed|ECONNREFUSED|ECONNRESET/.test(
      mensaje,
    )
  );
}
