/**
 * Core of the actas service.
 *
 * Fail fast instead of queueing (RF-10): with `enableOfflineQueue: false`
 * and a short `commandTimeout`, a dead Redis turns into an immediate error
 * that the modules map to an explicit degraded response.
 */
import { Redis, type RedisOptions } from 'ioredis';

export type RedisStatus = 'ok' | 'degraded';

const FAIL_FAST_OPTIONS: RedisOptions = {
  enableOfflineQueue: false,
  commandTimeout: 500,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
};

export function createRedis(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, { ...FAIL_FAST_OPTIONS, ...options });
}

/**
 * Connection for blocking reads (XREAD/XREADGROUP BLOCK). It must not share
 * the command connection and must not time out while blocked.
 */
export function createBlockingRedis(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, {
    ...options,
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });
}

export function redisStatus(redis: Redis): RedisStatus {
  return redis.status === 'ready' ? 'ok' : 'degraded';
}
