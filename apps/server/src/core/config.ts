/**
 * Bootstrap core (platform owner: Meneses). Minimal implementation so the
 * feature modules can run and be tested; the platform core replaces it
 * keeping these exports.
 */
import { z } from 'zod';

const envSchema = z.object({
  INSTANCE_ID: z.string().min(1).default('app1'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default('change-me-dev-only'),
  SUPABASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  SUPABASE_SERVICE_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
  PHOTO_DIR: z.string().default('./.data/photos'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
