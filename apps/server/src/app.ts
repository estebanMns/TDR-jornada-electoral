/**
 * Composition of the actas service (Fastify). The rest of the platform runs
 * in apps/web (Next.js custom server); nginx routes /api/actas here.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './core/config';
import { authorize, authPlugin } from './core/auth';
import type { Metrics } from './core/metrics';
import { fixedWindowRateLimit } from './core/rateLimit';
import { redisStatus } from './core/redis';
import { actasModule } from './modules/actas';

export interface AppDependencies {
  config: AppConfig;
  redis: Redis;
  createBlockingRedis: () => Redis;
  supabase: SupabaseClient | null;
  metrics: Metrics;
  /** Starts background workers (disabled in HTTP-only tests). */
  startWorkers?: boolean;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { config, redis } = deps;
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  // RT-1: every response says which instance answered.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Instance', config.INSTANCE_ID);
  });

  await app.register(authPlugin, { secret: config.JWT_SECRET });

  app.get('/api/whoami', async () => ({ instance: config.INSTANCE_ID, redis: redisStatus(redis) }));
  app.get('/api/health', async (_request, reply) =>
    redisStatus(redis) === 'ok' ? { status: 'ok' } : reply.code(503).send({ status: 'degraded' }),
  );

  await app.register(actasModule, {
    redis,
    supabase: deps.supabase,
    metrics: deps.metrics,
    instanceId: config.INSTANCE_ID,
    authorize,
    jurorRateLimit: fixedWindowRateLimit({
      redis,
      limit: 20,
      windowSeconds: 60,
      credential: (request) => `juror:${request.user.sub}`,
    }),
    photoBucket: config.SUPABASE_BUCKET_FOTOS,
    localPhotoDirectory: config.PHOTO_DIR,
    createBlockingRedis: deps.createBlockingRedis,
    startWorkers: deps.startWorkers ?? false,
  });

  return app;
}
