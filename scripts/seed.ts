/**
 * Deterministic catalog seed (GENERAL §6.1).
 *
 *   pnpm seed                  # catalog.json + Redis + Supabase (when configured)
 *   pnpm seed --no-redis       # skip Redis
 *   pnpm seed --no-supabase    # skip Supabase
 *
 * Env: REDIS_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY, SEED_JUROR_PASSWORD.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SEED, generateCatalog } from './catalog/generateCatalog';
import { loadCatalogIntoRedis } from './catalog/loadRedis';
import { loadCatalogIntoSupabase, loadJurorUsers } from './catalog/loadSupabase';

const CATALOG_PATH = fileURLToPath(new URL('../packages/shared/catalog.json', import.meta.url));

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const catalog = generateCatalog();
  console.info(
    `Catalog (seed ${DEFAULT_SEED}): ${catalog.municipalities.length} municipalities, ` +
      `${catalog.stations.length} stations, ${catalog.tables.length} tables`,
  );

  await writeFile(CATALOG_PATH, `${JSON.stringify(catalog)}\n`);
  console.info(`✔ ${CATALOG_PATH}`);

  if (!args.has('--no-redis')) {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
    });
    try {
      await loadCatalogIntoRedis(redis, catalog);
      console.info('✔ Redis catalog loaded');
    } finally {
      redis.disconnect();
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (args.has('--no-supabase')) return;
  if (!supabaseUrl || !supabaseKey) {
    console.warn('• Supabase skipped: SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  await loadCatalogIntoSupabase(supabase, catalog);
  console.info('✔ Supabase catalog upserted');

  const password = process.env.SEED_JUROR_PASSWORD;
  if (!password) {
    console.warn('• Juror users skipped: SEED_JUROR_PASSWORD not set');
    return;
  }
  await loadJurorUsers(supabase, catalog, password);
  console.info(`✔ ${catalog.tables.length} juror users upserted in usuarios (jurado0001 … jurado${catalog.tables.length})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
