import { z } from 'zod';

/**
 * Configuración validada con zod sobre `process.env`.
 * Falla al arrancar (no en la primera petición) si falta algo.
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  INSTANCE_ID: z.string().min(1).default('app-local'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRACION: z.string().default('8h'),

  REDIS_URL: z.string().url(),
  REDIS_PASSWORD: z.string().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  SUPABASE_BUCKET_FOTOS: z.string().default('actas-fotos'),

  WINDOW_MS: z.coerce.number().int().positive().default(2000),
  // Aperturas del stream público por IP y minuto (súbelo durante la prueba de carga).
  PUBLICO_LIMITE_POR_MIN: z.coerce.number().int().positive().default(30),

  // Actas service (Jose): auditor decisions are forwarded there.
  ACTAS_URL: z.string().url().default('http://localhost:3001'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/**
 * @typedef {Readonly<{
 *   entorno: 'development'|'production'|'test',
 *   esProduccion: boolean,
 *   instancia: string,
 *   http: { puerto: number, host: string },
 *   jwt: { secreto: string, expiracion: string },
 *   redis: { url: string, password?: string },
 *   supabase: { url: string, claveServicio: string, bucketFotos: string },
 *   difusion: { ventanaMs: number, limitePorMinuto: number },
 *   actas: { url: string },
 *   logNivel: string,
 * }>} Config
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Config}
 */
export function cargarConfig(env = process.env) {
  const resultado = esquema.safeParse(env);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${detalle}`);
  }
  const e = resultado.data;
  return Object.freeze({
    entorno: e.NODE_ENV,
    esProduccion: e.NODE_ENV === 'production',
    instancia: e.INSTANCE_ID,
    http: Object.freeze({ puerto: e.PORT, host: e.HOST }),
    jwt: Object.freeze({ secreto: e.JWT_SECRET, expiracion: e.JWT_EXPIRACION }),
    redis: Object.freeze({ url: e.REDIS_URL, password: e.REDIS_PASSWORD || undefined }),
    supabase: Object.freeze({
      url: e.SUPABASE_URL,
      claveServicio: e.SUPABASE_SERVICE_KEY,
      bucketFotos: e.SUPABASE_BUCKET_FOTOS,
    }),
    difusion: Object.freeze({ ventanaMs: e.WINDOW_MS, limitePorMinuto: e.PUBLICO_LIMITE_POR_MIN }),
    actas: Object.freeze({ url: e.ACTAS_URL }),
    logNivel: e.LOG_LEVEL,
  });
}
