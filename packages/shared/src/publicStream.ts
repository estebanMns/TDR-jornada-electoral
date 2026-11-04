/**
 * Public live results contract (GENERAL §7.3, owner: Evelyn).
 * Additive: new file, nothing existing changes.
 *
 * Spanish → code: delta | snapshot | estado | reconectar → delta | snapshot | status | reconnect;
 * cambios → changes; motivos → reasons; ts_rx_min → tsRxMin; mesas {informadas,total} → tables {reported,total}.
 */
import type { AccumulatedEventType } from './events';
import type { TopicId } from './topics';

export const SSE_EVENTS = {
  delta: 'delta',
  snapshot: 'snapshot',
  status: 'status',
  reconnect: 'reconnect',
} as const;
export type SseEventName = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];

/** Maximum topics per public connection. */
export const MAX_TOPICS_PER_CONNECTION = 3;

/** Why a value changed (shown to the public when a number goes down). */
export interface ChangeReason {
  acta: string;
  type: AccumulatedEventType;
  reason: string;
}

/** `event: delta` — new ABSOLUTE values of only the fields that changed. */
export interface PublicDelta {
  topic: TopicId;
  changes: Record<string, number>;
  reasons: ChangeReason[];
  /** Oldest `tsRx` merged in this message (receipt → publish latency). */
  tsRxMin: number;
}

/** `event: snapshot` — the whole state of a topic (also `GET /api/publico/snapshot`). */
export interface PublicSnapshot {
  /** Last `ev:all` id included (same id space as deltas). */
  id: string;
  topic: TopicId;
  /** Votes per option plus `_reported` and `_voters`. */
  totals: Record<string, number>;
  tables: { reported: number; total: number };
}

/** `event: status` — RF-10: updates paused while Redis is down. */
export interface PublicStatus {
  paused: boolean;
  /** Epoch ms when the pause started (only when paused). */
  since?: number;
}

/** `event: reconnect` — the server asks the client to come back with its last id. */
export interface PublicReconnect {
  reason: string;
}

/** Body of `POST /api/vitals`. */
export interface VitalSample {
  name: 'INP';
  value: number;
}

/**
 * Compares Redis stream ids (`ms-seq`). Negative if a < b.
 * Ids are compared numerically, never as strings.
 */
export function compareStreamIds(a: string, b: string): number {
  const [aMs = 0, aSeq = 0] = a.split('-').map(Number);
  const [bMs = 0, bSeq = 0] = b.split('-').map(Number);
  return aMs !== bMs ? aMs - bMs : aSeq - bSeq;
}

export function isStreamId(value: string): boolean {
  return /^\d+-\d+$/.test(value);
}

/** Milliseconds part of a stream id (when the event was written). */
export function streamIdTime(id: string): number {
  return Number(id.split('-')[0]);
}
