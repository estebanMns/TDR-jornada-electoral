import { buildApp } from './app';
import { loadConfig } from './core/config';
import { InMemoryMetrics } from './core/metrics';
import { createBlockingRedis, createRedis } from './core/redis';
import { createSupabase } from './core/supabase';

async function main(): Promise<void> {
  const config = loadConfig();
  const redisOptions = { password: config.REDIS_PASSWORD };
  const redis = createRedis(config.REDIS_URL, redisOptions);
  const app = await buildApp({
    config,
    redis,
    createBlockingRedis: () => createBlockingRedis(config.REDIS_URL, redisOptions),
    supabase: createSupabase(config),
    metrics: new InMemoryMetrics(),
    startWorkers: true,
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    redis.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.ACTAS_PORT, host: config.HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
