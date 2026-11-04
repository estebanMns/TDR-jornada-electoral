import type { SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import type { Catalog } from '@preconteo/contracts';

const UPSERT_CHUNK = 1_000;

async function upsertInChunks<Row extends object>(
  supabase: SupabaseClient,
  table: string,
  rows: Row[],
  onConflict: string,
): Promise<void> {
  for (let start = 0; start < rows.length; start += UPSERT_CHUNK) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(start, start + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`Upsert into ${table} failed: ${error.message}`);
  }
}

export async function loadCatalogIntoSupabase(supabase: SupabaseClient, catalog: Catalog): Promise<void> {
  await upsertInChunks(supabase, 'municipalities', catalog.municipalities, 'id');
  await upsertInChunks(
    supabase,
    'stations',
    catalog.stations.map((s) => ({ id: s.id, municipality_id: s.municipalityId, name: s.name })),
    'id',
  );
  await upsertInChunks(
    supabase,
    'voting_tables',
    catalog.tables.map((t) => ({
      id: t.id,
      station_id: t.stationId,
      number: t.number,
      enabled: t.enabled,
      acta_id: t.actaId,
    })),
    'id',
  );
  await upsertInChunks(supabase, 'vote_options', catalog.voteOptions, 'id');
}

/** Same pattern as the demo accounts of migration 001 (`auditor001`…). */
export function jurorUsername(tableId: number): string {
  return `jurado${String(tableId).padStart(4, '0')}`;
}

/**
 * Creates one demo juror per table in the platform table `usuarios`
 * (migration 001: `rol = 'JURADO'` requires `mesa`).
 *
 * TEST ENVIRONMENT ONLY: every juror shares `SEED_JUROR_PASSWORD`, so the
 * bcrypt hash is computed once and reused instead of 6,400 times.
 */
export async function loadJurorUsers(
  supabase: SupabaseClient,
  catalog: Catalog,
  sharedPassword: string,
): Promise<void> {
  const passwordHash = await bcrypt.hash(sharedPassword, 10);
  await upsertInChunks(
    supabase,
    'usuarios',
    catalog.tables.map((table) => ({
      username: jurorUsername(table.id),
      password_hash: passwordHash,
      rol: 'JURADO',
      nombre: `Jurado mesa ${table.id}`,
      mesa: table.id,
    })),
    'username',
  );
}
