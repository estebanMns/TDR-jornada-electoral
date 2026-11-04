import type { TopicId } from './topics';

export const ACCUMULATED_EVENT_TYPES = ['APPLIED', 'CORRECTION', 'REVERSAL'] as const;
export type AccumulatedEventType = (typeof ACCUMULATED_EVENT_TYPES)[number];

/** Reasons attached to `ev:all` events. */
export const EVENT_REASONS = {
  firstReport: 'FIRST_REPORT',
  correction: 'CORRECTION',
  underReview: 'UNDER_REVIEW',
  resolution: 'RESOLUTION',
} as const;

/**
 * New ABSOLUTE values of only the fields that changed, per topic.
 * Applying the same values twice is harmless (idempotent merge, last wins).
 */
export type AbsoluteValues = Partial<Record<TopicId, Record<string, number>>>;

/**
 * Flat fields of every `ev:all` stream entry (written by `apply_acta.lua`).
 * Stream entries are string maps; numbers are serialized as strings and
 * `abs` is the JSON of {@link AbsoluteValues}.
 */
export type AccumulatedStreamFields = Record<
  'acta' | 'version' | 'type' | 'reason' | 'tsRx' | 'table' | 'station' | 'mun' | 'abs',
  string
>;

/** Parsed `ev:all` entry. */
export interface AccumulatedEvent {
  /** Stream id: monotonic, used as SSE `Last-Event-ID`. */
  id: string;
  acta: string;
  version: number;
  type: AccumulatedEventType;
  reason: string;
  /** Epoch ms when the acta was received (receipt → publish latency). */
  tsRx: number;
  table: number;
  station: number;
  mun: number;
  abs: AbsoluteValues;
}

export function parseAccumulatedEvent(id: string, fields: Record<string, string>): AccumulatedEvent {
  return {
    id,
    acta: fields.acta ?? '',
    version: Number(fields.version),
    type: fields.type as AccumulatedEventType,
    reason: fields.reason ?? '',
    tsRx: Number(fields.tsRx),
    table: Number(fields.table),
    station: Number(fields.station),
    mun: Number(fields.mun),
    abs: JSON.parse(fields.abs ?? '{}') as AbsoluteValues,
  };
}

/** Kinds of `ev:actas` entries consumed by the persistence worker. */
export const PERSISTENCE_EVENT_KINDS = ['VERSION', 'STATUS', 'RESOLUTION', 'PHOTO'] as const;
export type PersistenceEventKind = (typeof PERSISTENCE_EVENT_KINDS)[number];
