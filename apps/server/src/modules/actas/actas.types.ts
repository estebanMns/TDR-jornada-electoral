import type { ActaStatus, ReceiptResult, ResolutionResult, ReviewDecision, Votes } from '@preconteo/contracts';

/** Catalog entry of a table as stored in `cat:table:{id}`. */
export interface CatalogTableEntry {
  tableId: number;
  stationId: number;
  munId: number;
  enabled: number;
  actaId: string;
  stationName: string;
  munName: string;
}

/** Position of a review case in `verif:queue` (verification module contract). */
export interface ReviewPlacement {
  /** 1 = reviewed first … 3 = normal. */
  level: number;
  /** level · 1e13 + enqueuedAt (lower score = reviewed first). */
  score: number;
}

interface BaseContext {
  actaId: string;
  version: number;
  tableId: number;
  stationId: number;
  munId: number;
  enabled: number;
  stationName: string;
  munName: string;
  /** Epoch ms of reception (ts_rx). */
  tsRx: number;
  instance: string;
}

/** Context of `apply_acta.lua` for a juror submission. */
export interface SubmitContext extends BaseContext {
  mode: 'SUBMIT';
  juror: string;
  votes: Votes;
  voters: number;
  photoHash: string;
  contentHash: string;
  idempotencyKey: string;
  receiptId: string;
  doubtful: boolean;
  reason: string;
  /** Placement of the case if this version is doubtful. */
  review: ReviewPlacement;
  /** Placement of the case if this version conflicts with the registered one. */
  conflictReview: ReviewPlacement;
}

/** Context of `apply_acta.lua` for an auditor decision. */
export interface ResolutionContext extends BaseContext {
  mode: 'RESOLUTION';
  decision: ReviewDecision;
  votes?: Votes;
  voters?: number;
  auditor: string;
  fencing: number;
  reason: string;
}

export type ApplyActaContext = SubmitContext | ResolutionContext;

export interface ApplyActaOutcome {
  result: ReceiptResult | ResolutionResult;
  reason?: string;
  receiptId?: string;
  registeredAt?: number;
  replayed?: boolean;
  status?: ActaStatus;
  error?: 'IDEMPOTENCY_KEY_REUSED';
}

/** Raw `acta:{id}` hash used for the juror status listing. */
export interface StoredActaState {
  actaId: string;
  tableId: number;
  maxVersion: number;
  appliedVersion: number;
  status: ActaStatus;
  reason?: string;
  updatedAt: number;
}

/** Immutable record of a received version (`acta:{id}:v:{n}`). */
export interface StoredVersionRecord {
  actaId: string;
  version: number;
  tableId: number;
  stationId: number;
  munId: number;
  juror: string;
  votes: Votes;
  voters: number;
  photoHash: string;
  status: ActaStatus;
  reason: string;
  idempotencyKey: string;
  instance: string;
  receiptId: string;
  receivedAt: number;
}
