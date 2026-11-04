/**
 * Core of the actas service. Fixed-window counter in Redis
 * (`rl:{credential}:{window}` INCR + EXPIRE), GENERAL §7.1.
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import { redisKeys } from '@preconteo/contracts';

export interface RateLimitOptions {
  redis: Redis;
  limit: number;
  windowSeconds: number;
  credential: (request: FastifyRequest) => string;
}

export function fixedWindowRateLimit(options: RateLimitOptions): preHandlerAsyncHookHandler {
  const { redis, limit, windowSeconds, credential } = options;
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const window = Math.floor(nowSeconds / windowSeconds);
    const key = redisKeys.rateLimit(credential(request), window);
    let count: number;
    try {
      const [[, incremented]] = (await redis.multi().incr(key).expire(key, windowSeconds).exec()) as [
        [Error | null, number],
      ];
      count = incremented;
    } catch {
      // Fail open: the route itself reports Redis being down explicitly.
      return;
    }
    if (count > limit) {
      const retryIn = (window + 1) * windowSeconds - nowSeconds;
      return reply
        .code(429)
        .header('Retry-After', String(retryIn))
        .send({ error: 'RATE_LIMIT', retryIn });
    }
  };
}
