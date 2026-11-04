import { redisKeys } from '@preconteo/shared';

const { presencia: P } = redisKeys;

/**
 * Presencia de auditores (RF-8): `presence:{sub}` con TTL + índice ZSET por último latido.
 * Si no llega latido, la clave expira sola; el índice se poda al listar.
 */
export class PresenciaRepository {
  /** @param {{ redis: import('../../core/redis/RedisGateway.js').RedisGateway, ttlSeg?: number }} deps */
  constructor({ redis, ttlSeg = 30 }) {
    this.redis = redis;
    this.ttlSeg = ttlSeg;
  }

  /**
   * Guarda la entrada y devuelve la anterior (para detectar cambios y no publicar de más).
   * @returns {Promise<object|null>}
   */
  async registrar(entrada, ahora) {
    const [[, anterior]] = await this.redis.ejecutar((r) =>
      r
        .multi()
        .set(P.de(entrada.sub), JSON.stringify(entrada), 'EX', this.ttlSeg, 'GET')
        .zadd(P.indice, ahora, entrada.sub)
        .exec(),
    );
    return anterior ? JSON.parse(anterior) : null;
  }

  async eliminar(sub) {
    await this.redis.ejecutar((r) => r.multi().del(P.de(sub)).zrem(P.indice, sub).exec());
  }

  /** Auditores con latido en la ventana TTL; poda los fantasmas del índice. */
  async listar(ahora) {
    const limite = ahora - this.ttlSeg * 1000;
    const [, [, subs]] = await this.redis.ejecutar((r) =>
      r
        .multi()
        .zremrangebyscore(P.indice, '-inf', limite)
        .zrangebyscore(P.indice, `(${limite}`, '+inf')
        .exec(),
    );
    if (subs.length === 0) return [];
    const valores = await this.redis.ejecutar((r) => r.mget(subs.map(P.de)));
    return valores.filter(Boolean).map((v) => JSON.parse(v));
  }
}
