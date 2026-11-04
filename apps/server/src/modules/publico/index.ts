import fp from 'fastify-plugin';
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import type { Metrics } from '../../core/metrics';
import { ThresholdBackpressurePolicy, type BackpressurePolicy } from './backpressure';
import { PublicoRepository } from './publico.repository';
import { publicoRoutes } from './publico.routes';
import { PublicStreamService } from './publico.service';
import { VitalsService } from './vitals.service';

declare module 'fastify' {
  interface FastifyInstance {
    publicStream: PublicStreamService;
  }
}

export interface PublicoModuleOptions {
  redis: Redis;
  /** Factory of the dedicated XREAD BLOCK connection. */
  createBlockingRedis: () => Redis;
  metrics: Metrics;
  instanceId: string;
  /** Aggregation window (`WINDOW_MS`, default 2000). */
  windowMs: number;
  streamRateLimit: preHandlerAsyncHookHandler;
  vitalsRateLimit: preHandlerAsyncHookHandler;
  /** Slow-client strategy (RF-9). */
  policy?: BackpressurePolicy;
}

/** Live public results over SSE (owner: Evelyn). */
export const publicoModule = fp<PublicoModuleOptions>(
  async (app, options) => {
    const repository = new PublicoRepository(options.redis);
    const service = new PublicStreamService({
      redis: options.redis,
      blockingRedis: options.createBlockingRedis(),
      repository,
      policy: options.policy ?? new ThresholdBackpressurePolicy(),
      metrics: options.metrics,
      windowMs: options.windowMs,
      logger: app.log,
    });
    const vitals = new VitalsService(repository, options.metrics);

    app.decorate('publicStream', service);
    await app.register(publicoRoutes, {
      service,
      vitals,
      repository,
      redis: options.redis,
      instanceId: options.instanceId,
      streamRateLimit: options.streamRateLimit,
      vitalsRateLimit: options.vitalsRateLimit,
    });

    app.addHook('onReady', async () => {
      await service.start();
      vitals.start();
    });
    app.addHook('preClose', async () => {
      vitals.stop();
      await service.stop(); // every client gets `reconnect` before the socket closes
    });
  },
  { name: 'publico' },
);
