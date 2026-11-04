import { redisKeys } from '@preconteo/shared';
import { TareaPeriodica } from '../tasks/TareaPeriodica.js';

const TTL_SEG = 10;

/**
 * Publica cada 2 s la fotografía de métricas de esta instancia en
 * `metrics:inst:{id}` (HASH, EX 10) y la registra en `metrics:instances` (ZSET).
 * Si la instancia muere, su clave expira sola y el tablero deja de verla.
 */
export class MetricsPublisher extends TareaPeriodica {
  /**
   * @param {{ instancia: string, metrics: import('./MetricsRegistry.js').MetricsRegistry,
   *           redis: import('../redis/RedisGateway.js').RedisGateway,
   *           logger: import('pino').Logger, intervaloMs?: number }} deps
   */
  constructor({ instancia, metrics, redis, logger, intervaloMs = 2_000 }) {
    super({ nombre: 'metrics-publisher', intervaloMs, logger, ejecutar: () => this.publicar() });
    this.instancia = instancia;
    this.metrics = metrics;
    this.redis = redis;
  }

  async publicar() {
    const fotografia = { instancia: this.instancia, ...this.metrics.fotografia() };
    if (!this.redis.disponible()) return; // degradado: se descarta la ventana, no se acumula
    const clave = redisKeys.metricas.instancia(this.instancia);
    await this.redis.ejecutar((r) =>
      r
        .multi()
        .hset(clave, { json: JSON.stringify(fotografia), ts: fotografia.ts })
        .expire(clave, TTL_SEG)
        .zadd(redisKeys.metricas.instancias, fotografia.ts, this.instancia)
        .exec(),
    );
  }
}
