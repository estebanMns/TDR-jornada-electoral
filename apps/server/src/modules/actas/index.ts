import fp from 'fastify-plugin';
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Authorize } from '../../core/auth';
import type { Metrics } from '../../core/metrics';
import { ActasRepository } from './actas.repository';
import { actasRoutes } from './actas.routes';
import { ActasService } from './actas.service';
import { LocalPhotoStorage, SupabasePhotoStorage } from './photo.storage';

declare module 'fastify' {
  interface FastifyInstance {
    /** Public interface of the module (GENERAL §7.5): `actasService.applyResolution(...)`. */
    actasService: ActasService;
  }
}

export interface ActasModuleOptions {
  redis: Redis;
  supabase: SupabaseClient | null;
  metrics: Metrics;
  instanceId: string;
  authorize: Authorize;
  jurorRateLimit: preHandlerAsyncHookHandler;
  /** Used when Supabase is not configured (local development). */
  localPhotoDirectory: string;
}

/** Ingestion module: actas reception, photos and juror status (owner: Jose). */
export const actasModule = fp<ActasModuleOptions>(
  async (app, options) => {
    const repository = new ActasRepository(options.redis);
    const photoStorage = options.supabase
      ? new SupabasePhotoStorage(options.supabase)
      : new LocalPhotoStorage(options.localPhotoDirectory);
    const service = new ActasService({
      repository,
      photoStorage,
      metrics: options.metrics,
      instanceId: options.instanceId,
    });

    app.decorate('actasService', service);
    await app.register(actasRoutes, {
      service,
      authorize: options.authorize,
      jurorRateLimit: options.jurorRateLimit,
      instanceId: options.instanceId,
    });
  },
  { name: 'actas' },
);
