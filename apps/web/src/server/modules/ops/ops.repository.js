import { redisKeys } from '@preconteo/shared';

const { metricas: K } = redisKeys;

/** Lee las fotografías de métricas que publica cada instancia (`core/metrics`). */
export class OpsRepository {
  /** @param {{ redis: import('../../core/redis/RedisGateway.js').RedisGateway, vigenciaMs?: number }} deps */
  constructor({ redis, vigenciaMs = 10_000 }) {
    this.redis = redis;
    this.vigenciaMs = vigenciaMs;
  }

  /** Instancias con reporte vigente; poda del índice las que dejaron de reportar. */
  async instanciasVivas(ahora) {
    const limite = ahora - this.vigenciaMs;
    const [, [, ids]] = await this.redis.ejecutar((r) =>
      r
        .multi()
        .zremrangebyscore(K.instancias, '-inf', limite)
        .zrangebyscore(K.instancias, `(${limite}`, '+inf')
        .exec(),
    );
    if (ids.length === 0) return [];
    const respuestas = await this.redis.ejecutar((r) => {
      const tuberia = r.pipeline();
      for (const id of ids) tuberia.hget(K.instancia(id), 'json');
      return tuberia.exec();
    });
    return respuestas
      .map(([err, json]) => (err || !json ? null : JSON.parse(json)))
      .filter(Boolean);
  }
}
