const MARCA = Symbol.for('preconteo.RedisNoDisponibleError');

/** Se lanza cuando Redis está degradado: fallar rápido y explícito (RF-10). */
export class RedisNoDisponibleError extends Error {
  constructor(causa) {
    super('Redis no disponible', { cause: causa });
    this.name = 'RedisNoDisponibleError';
    this[MARCA] = true;
  }

  static es(e) {
    return Boolean(e && e[MARCA]);
  }
}
