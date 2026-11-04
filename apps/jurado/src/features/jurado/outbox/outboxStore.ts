import { createStore, get, set, values } from 'idb-keyval';
import type { ActaReceipt, ActaSubmission } from '@preconteo/contracts';

export type DeliveryState =
  /** Waiting for its next attempt (offline, server unavailable…). */
  | 'QUEUED'
  /** A request is in flight. */
  | 'SENDING'
  /** Definitive receipt obtained. */
  | 'DELIVERED'
  /** The server refused the content; the juror must create a correction. */
  | 'FAILED';

export type PhotoState = 'PENDING' | 'UPLOADED' | 'SKIPPED';

/** One logical transmission. Its idempotency key is created once and reused in every retry. */
export interface OutboxEntry {
  idempotencyKey: string;
  submission: ActaSubmission;
  photo: Blob;
  state: DeliveryState;
  receipt?: ActaReceipt;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  photoState: PhotoState;
  photoAttempts: number;
  photoNextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
}

const store = createStore('electoral-juror', 'outbox');

export const outboxStore = {
  get: (idempotencyKey: string) => get<OutboxEntry>(idempotencyKey, store),
  put: (entry: OutboxEntry) => set(entry.idempotencyKey, entry, store),
  list: async (): Promise<OutboxEntry[]> =>
    (await values<OutboxEntry>(store)).sort((a, b) => b.createdAt - a.createdAt),
};
