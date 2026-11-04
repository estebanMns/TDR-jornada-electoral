/**
 * Configuration of the actas service (Fastify). It shares the root `.env`
 * with the platform server (apps/web), so it has its own port variable.
 */
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

const envSchema = z.object({
  INSTANCE_ID: z.string().min(1).default('app1'),
  /** The Next.js platform server uses PORT (3000); this service listens on ACTAS_PORT. */
  ACTAS_PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_PASSWORD: optionalString,
  /** Same secret as the platform: tokens issued by its login are valid here. */
  JWT_SECRET: z.string().min(16).default('change-me-dev-only'),
  SUPABASE_URL: optionalString.pipe(z.string().url().optional()),
  SUPABASE_SERVICE_KEY: optionalString,
  SUPABASE_BUCKET_FOTOS: z.string().min(1).default('actas-fotos'),
  PHOTO_DIR: z.string().default('./.data/photos'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
