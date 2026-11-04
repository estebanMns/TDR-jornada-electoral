import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Where acta photos live. `put` must be idempotent (same path → overwrite). */
export interface PhotoStorage {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export const ACTA_PHOTOS_BUCKET = 'acta-photos';

export function actaPhotoPath(actaId: string, version: number): string {
  return `${actaId}/v${version}.jpg`;
}

/** Private Supabase Storage bucket (production). */
export class SupabasePhotoStorage implements PhotoStorage {
  constructor(private readonly supabase: SupabaseClient) {}

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(ACTA_PHOTOS_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) throw error;
  }
}

/** Local directory (development without Supabase). */
export class LocalPhotoStorage implements PhotoStorage {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    const target = resolve(join(this.root, path));
    if (!target.startsWith(this.root)) throw new Error('Invalid photo path');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
