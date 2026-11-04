import fp from 'fastify-plugin';
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Authorize } from '../../core/auth';
import type { Metrics } from '../../core/metrics';
import { ActasRepository } from './actas.repository';
import { actasRoutes } from './actas.routes';
import { ActasService } from './actas.service';
import { SupabaseActaHistoryStore } from './history.store';
import { PersistenceWorker } from './persistence.worker';
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
  /** Supabase Storage bucket for the acta photos. */
  photoBucket: string;
  /** Used when Supabase is not configured (local development). */
  localPhotoDirectory: string;
  /** Factory of the dedicated connection used by the persistence worker. */
  createBlockingRedis: () => Redis;
  startWorkers: boolean;
}

/** Ingestion module: actas reception, photos and juror status (owner: Jose). */
export const actasModule = fp<ActasModuleOptions>(
  async (app, options) => {
    const repository = new ActasRepository(options.redis);
    const photoStorage = options.supabase
      ? new SupabasePhotoStorage(options.supabase, options.photoBucket)
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

    if (options.startWorkers) {
      if (options.supabase) {
        const worker = new PersistenceWorker({
          redis: options.createBlockingRedis(),
          store: new SupabaseActaHistoryStore(options.supabase),
          consumer: options.instanceId,
          logger: app.log,
        });
        app.addHook('onReady', () => worker.start());
        app.addHook('onClose', () => worker.stop());
      } else {
        app.log.warn('Supabase not configured: acta history is kept only in the ev:actas stream');
      }
    }
  },
  { name: 'actas' },
);
