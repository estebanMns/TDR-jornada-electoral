/**
 * Pub/Sub con mensajes JSON (patrón Observer sobre Redis).
 *
 * Se (re)suscribe a todos los canales cada vez que la conexión queda `ready`,
 * así que un corte de Redis no deja a la instancia sorda al volver.
 */
export class RedisPubSub {
  /** @type {Map<string, Set<(mensaje: any) => void>>} */
  #manejadores = new Map();
  #suscriptor;
  #gateway;
  #logger;

  /**
   * @param {{ gateway: import('./RedisGateway.js').RedisGateway, logger: import('pino').Logger }} deps
   */
  constructor({ gateway, logger }) {
    this.#gateway = gateway;
    this.#logger = logger.child({ componente: 'pubsub' });
    this.#suscriptor = gateway.crearConexionSuscriptor('pubsub');
    this.#suscriptor.on('ready', () => this.#suscribirTodo());
    this.#suscriptor.on('message', (canal, texto) => this.#despachar(canal, texto));
  }

  /**
   * @param {string} canal
   * @param {(mensaje: any) => void} manejador
   * @returns {() => void} función para cancelar la suscripción local
   */
  suscribir(canal, manejador) {
    const nuevoCanal = !this.#manejadores.has(canal);
    if (nuevoCanal) this.#manejadores.set(canal, new Set());
    this.#manejadores.get(canal).add(manejador);
    if (nuevoCanal && this.#suscriptor.status === 'ready') {
      this.#suscriptor
        .subscribe(canal)
        .catch((err) => this.#logger.warn({ err, canal }, 'subscribe falló'));
    }
    return () => this.#manejadores.get(canal)?.delete(manejador);
  }

  /** @param {string} canal @param {object} mensaje */
  publicar(canal, mensaje) {
    return this.#gateway.ejecutar((redis) => redis.publish(canal, JSON.stringify(mensaje)));
  }

  #suscribirTodo() {
    const canales = [...this.#manejadores.keys()];
    if (canales.length === 0) return;
    this.#suscriptor
      .subscribe(...canales)
      .then(() => this.#logger.info({ canales }, 'suscrito'))
      .catch((err) => this.#logger.warn({ err }, 'resuscripción falló'));
  }

  #despachar(canal, texto) {
    let mensaje;
    try {
      mensaje = JSON.parse(texto);
    } catch {
      this.#logger.warn({ canal }, 'mensaje Pub/Sub no es JSON; se descarta');
      return;
    }
    for (const manejador of this.#manejadores.get(canal) ?? []) {
      try {
        manejador(mensaje);
      } catch (err) {
        this.#logger.error({ err, canal }, 'manejador Pub/Sub lanzó un error');
      }
    }
  }
}
