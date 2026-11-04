/**
 * Bootstrap core (platform owner: Meneses). Supabase is optional in local
 * development: ingestion never depends on it (GENERAL §2).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config';

export function createSupabase(config: AppConfig): SupabaseClient | null {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) return null;
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
