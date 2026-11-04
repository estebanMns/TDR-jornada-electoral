import type { Votes } from './voteOptions';

/** Body of `POST /api/actas`. The idempotency key travels in the `Idempotency-Key` header. */
export interface ActaSubmission {
  /** `E14-{stationId}-{tableNumberInStation:4}-{corporation:2}`. */
  actaId: string;
  /** Integer >= 1. Every correction creates `version + 1`. */
  version: number;
  /** Global table number (1..6400). Must match the JWT `tableId`. */
  tableId: number;
  votes: Votes;
  /** Number of citizens that voted at the table. */
  voters: number;
  /** SHA-256 (hex) of the acta photo. */
  photoHash: string;
}

export const RECEIPT_RESULTS = [
  /** First time this version is seen and it was applied to the totals. */
  'REGISTERED',
  /** Identical resend: original receipt, nothing added twice. */
  'ALREADY_REGISTERED',
  /** A greater version already exists; nothing changed. */
  'OBSOLETE',
  /** Registered but doubtful: contributes 0 until an auditor resolves it. */
  'UNDER_REVIEW',
  /** Same version with different content: sent to review. */
  'CONFLICT',
  /** Nothing was written (e.g. Redis down). The client MUST retry. HTTP 503. */
  'NOT_REGISTERED',
] as const;
export type ReceiptResult = (typeof RECEIPT_RESULTS)[number];

/** Results that end the retry loop of the juror outbox. */
export const DEFINITIVE_RESULTS: readonly ReceiptResult[] = RECEIPT_RESULTS.filter(
  (result) => result !== 'NOT_REGISTERED',
);

export function isDefinitiveResult(result: ReceiptResult): boolean {
  return DEFINITIVE_RESULTS.includes(result);
}

export const DOUBT_REASONS = {
  tallyMismatch: 'TALLY_MISMATCH',
  votersExceedEnabled: 'VOTERS_EXCEED_ENABLED',
  contentConflict: 'CONTENT_CONFLICT',
} as const;
export type DoubtReason = (typeof DOUBT_REASONS)[keyof typeof DOUBT_REASONS];

/** Response of `POST /api/actas`. Always unambiguous (RF-1). */
export interface ActaReceipt {
  actaId: string;
  version: number;
  result: ReceiptResult;
  reason?: string;
  /** Instance that answered this request. */
  instance: string;
  /** Epoch ms when the version was first registered. */
  registeredAt?: number;
  /** Stable id of the original registration (same across resends). */
  receiptId?: string;
  /** `true` when this receipt was replayed from a previous registration. */
  replayed?: boolean;
}

/** Lifecycle of an acta as stored in `acta:{id}.status`. */
export const ACTA_STATUSES = ['APPLIED', 'UNDER_REVIEW', 'CONFLICT', 'REJECTED'] as const;
export type ActaStatus = (typeof ACTA_STATUSES)[number];

/** One item of `GET /api/actas/mine`. */
export interface JurorActaState {
  actaId: string;
  tableId: number;
  maxVersion: number;
  /** Version currently added to the totals (0 = none). */
  appliedVersion: number;
  status: ActaStatus;
  reason?: string;
  updatedAt: number;
}

export const REVIEW_DECISIONS = ['APPROVE', 'APPROVE_WITH_CORRECTION', 'REJECT'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Input of `ActasService.applyResolution` (called by the verification module). */
export interface ResolutionInput {
  actaId: string;
  version: number;
  decision: ReviewDecision;
  /** Required for `APPROVE_WITH_CORRECTION`. */
  votes?: Votes;
  /** Corrected voters; defaults to the registered value. */
  voters?: number;
  auditor: string;
  fencing: number;
  reason?: string;
}

export const RESOLUTION_RESULTS = [
  'RESOLVED',
  /** A newer version of the acta arrived: the decision is about an old one. */
  'OBSOLETE',
  /** The version is not waiting for review (already decided, or it was valid). */
  'NOT_UNDER_REVIEW',
  /** The fencing token is not newer than the last applied decision (late auditor). */
  'STALE_FENCING',
] as const;
export type ResolutionResult = (typeof RESOLUTION_RESULTS)[number];

export interface ResolutionReceipt {
  actaId: string;
  version: number;
  result: ResolutionResult;
  status?: ActaStatus;
}
