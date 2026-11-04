import {
  actaReceiptSchema,
  type ActaReceipt,
  type ActaSubmission,
  type JurorActaState,
} from '@preconteo/contracts';
import { httpRequest } from '../../../shared/net/http';

/** Outcome of one delivery attempt, already classified for the outbox. */
export type SubmitOutcome =
  /** Definitive receipt: the acta leaves the queue. */
  | { kind: 'receipt'; receipt: ActaReceipt }
  /** Nothing was registered (NOT_REGISTERED, 5xx, rate limit…): retry later. */
  | { kind: 'retry'; code: string; retryAfterMs?: number }
  /** The token is no longer valid: keep the acta and ask to log in again. */
  | { kind: 'unauthorized' }
  /** The server refused the content: the juror must correct it. */
  | { kind: 'rejected'; code: string; message?: string };

function retryAfterMs(headers: Headers): number | undefined {
  const seconds = Number(headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

export async function submitActa(
  token: string,
  submission: ActaSubmission,
  idempotencyKey: string,
): Promise<SubmitOutcome> {
  const response = await httpRequest<unknown>('/api/actas', {
    method: 'POST',
    token,
    headers: { 'idempotency-key': idempotencyKey },
    body: submission,
  });
  const receipt = actaReceiptSchema.safeParse(response.body);

  if (receipt.success && receipt.data.result !== 'NOT_REGISTERED' && response.status < 300) {
    return { kind: 'receipt', receipt: receipt.data };
  }
  if (response.status === 401) return { kind: 'unauthorized' };
  if (response.status === 429 || response.status >= 500 || receipt.data?.result === 'NOT_REGISTERED') {
    return { kind: 'retry', code: receipt.data?.result ?? `HTTP_${response.status}`, retryAfterMs: retryAfterMs(response.headers) };
  }
  const error = response.body as { error?: string; message?: string } | null;
  return { kind: 'rejected', code: error?.error ?? `HTTP_${response.status}`, message: error?.message };
}

export type PhotoOutcome = 'stored' | 'retry' | 'unauthorized' | 'rejected';

export async function uploadPhoto(token: string, actaId: string, version: number, photo: Blob): Promise<PhotoOutcome> {
  const response = await httpRequest<unknown>(`/api/actas/${encodeURIComponent(actaId)}/v/${version}/photo`, {
    method: 'PUT',
    token,
    body: photo,
    timeoutMs: 30_000,
  });
  if (response.status === 204) return 'stored';
  if (response.status === 401) return 'unauthorized';
  if (response.status === 429 || response.status >= 500) return 'retry';
  return 'rejected';
}

export type MineOutcome = { kind: 'not-modified' } | { kind: 'changed'; etag: string | null; actas: JurorActaState[] };

/** Conditional GET: an unchanged status costs a 304 with no body. */
export async function fetchMine(token: string, etag: string | null): Promise<MineOutcome> {
  const response = await httpRequest<{ actas: JurorActaState[] }>('/api/actas/mine', {
    token,
    headers: etag ? { 'if-none-match': etag } : {},
  });
  if (response.status === 304) return { kind: 'not-modified' };
  if (response.status !== 200 || !response.body) throw new Error(`HTTP_${response.status}`);
  return { kind: 'changed', etag: response.headers.get('etag'), actas: response.body.actas };
}
