/**
 * Un canal Pub/Sub concreto (p. ej. `ch:verif`). Los servicios publican eventos
 * de dominio aquí sin saber quién los consume (gateway WS, otras instancias…).
 */
export class CanalRedis {
  /**
   * @param {{ pubsub: import('./RedisPubSub.js').RedisPubSub, canal: string,
   *           logger: import('pino').Logger }} deps
   */
  constructor({ pubsub, canal, logger }) {
    this.pubsub = pubsub;
    this.canal = canal;
    this.logger = logger;
  }

  /** Publica; lanza si Redis no está disponible. */
  publicar(mensaje) {
    return this.pubsub.publicar(this.canal, mensaje);
  }

  /**
   * Publica sin propagar errores: para notificaciones posteriores a una
   * operación que YA se completó (la operación no debe "fallar" por avisar).
   */
  async publicarSinFallar(mensaje) {
    try {
      await this.publicar(mensaje);
    } catch (err) {
      this.logger.warn(
        { err: err.message, canal: this.canal, tipo: mensaje.tipo },
        'no se pudo publicar',
      );
    }
  }

  /** @param {(mensaje: any) => void} manejador */
  escuchar(manejador) {
    return this.pubsub.suscribir(this.canal, manejador);
  }
}
