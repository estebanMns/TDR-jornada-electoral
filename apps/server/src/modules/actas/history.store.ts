import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActaStatus, ReviewDecision, Votes } from '@preconteo/contracts';
import type { StoredVersionRecord } from './actas.types';

export interface StatusChange {
  actaId: string;
  version: number;
  status: ActaStatus;
  reason?: string;
}

export interface ResolutionRecord extends StatusChange {
  decision: ReviewDecision;
  auditor: string;
  fencing: number;
  votes?: Votes;
  voters?: number;
  resolvedAt: number;
}

export interface PhotoStored {
  actaId: string;
  version: number;
  path: string;
}

/** Thrown when an update arrives before the row it updates: retry later. */
export class HistoryRowMissingError extends Error {
  constructor(actaId: string, version: number) {
    super(`acta_versions row ${actaId} v${version} does not exist yet`);
  }
}

/**
 * Durable history of actas (Supabase). Every operation is idempotent so a
 * message can be processed more than once (at-least-once delivery).
 */
export interface ActaHistoryStore {
  /** Inserts the version if absent; never overwrites a later status. */
  saveVersion(record: StoredVersionRecord): Promise<void>;
  updateStatus(change: StatusChange): Promise<void>;
  saveResolution(resolution: ResolutionRecord): Promise<void>;
  setPhotoPath(photo: PhotoStored): Promise<void>;
}

export class SupabaseActaHistoryStore implements ActaHistoryStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async saveVersion(record: StoredVersionRecord): Promise<void> {
    const { error } = await this.supabase.from('acta_versions').upsert(
      {
        acta_id: record.actaId,
        version: record.version,
        table_id: record.tableId,
        station_id: record.stationId,
        municipality_id: record.munId,
        juror: record.juror,
        votes: record.votes,
        voters: record.voters,
        photo_hash: record.photoHash,
        status: record.status,
        reason: record.reason || null,
        idempotency_key: record.idempotencyKey,
        instance: record.instance,
        received_at: new Date(record.receivedAt).toISOString(),
      },
      { onConflict: 'acta_id,version', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async updateStatus(change: StatusChange): Promise<void> {
    await this.updateVersion(change.actaId, change.version, {
      status: change.status,
      reason: change.reason || null,
    });
  }

  /**
   * Only the outcome on the version row. The decision itself (auditor, fencing,
   * corrected votes) is stored in `verificaciones` by the verification module.
   */
  async saveResolution(resolution: ResolutionRecord): Promise<void> {
    await this.updateStatus(resolution);
  }

  async setPhotoPath(photo: PhotoStored): Promise<void> {
    await this.updateVersion(photo.actaId, photo.version, { photo_path: photo.path });
  }

  private async updateVersion(actaId: string, version: number, values: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.supabase
      .from('acta_versions')
      .update(values)
      .eq('acta_id', actaId)
      .eq('version', version)
      .select('acta_id');
    if (error) throw error;
    if (!data || data.length === 0) throw new HistoryRowMissingError(actaId, version);
  }
}
