import type { ActaStatus, ReceiptResult, ResolutionResult, ReviewDecision, Votes } from '@preconteo/contracts';

/** Catalog entry of a table as stored in `cat:table:{id}`. */
export interface CatalogTableEntry {
  tableId: number;
  stationId: number;
  munId: number;
  enabled: number;
  actaId: string;
}

interface BaseContext {
  actaId: string;
  version: number;
  tableId: number;
  stationId: number;
  munId: number;
  enabled: number;
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
  /** Score in `verif:queue` (lower = reviewed first). */
  priority: number;
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
