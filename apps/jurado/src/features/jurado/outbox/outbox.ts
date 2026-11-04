import type { ActaSubmission } from '@preconteo/contracts';
import { backoffDelay } from '../../../shared/net/backoff';
import { NetworkError, TimeoutError } from '../../../shared/net/http';
import { submitActa, uploadPhoto } from '../api/actasApi';
import { outboxStore, type OutboxEntry } from './outboxStore';

const TICK_MS = 3_000;
const UNAUTHORIZED_RETRY_MS = 30_000;
const LOCK_NAME = 'electoral-juror-outbox';
const CHANNEL_NAME = 'electoral-juror-outbox';

type Listener = () => void;

export interface OutboxOptions {
  /** Dev token; null when the platform session cookie authenticates. */
  getToken: () => string | null;
  now?: () => number;
}

/**
 * Outbox pattern (RT-6): every transmission is first saved in IndexedDB and
 * then delivered by this dispatcher, which retries with exponential backoff
 * and full jitter until it gets a DEFINITIVE receipt. Closing the tab, losing
 * the network or a server returning NOT_REGISTERED never loses an acta, and
 * the reused idempotency key makes every retry harmless.
 */
export class Outbox {
  private entries: OutboxEntry[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private running = false;
  private rerun = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  sessionExpired = false;

  constructor(private readonly options: OutboxOptions) {
    this.now = options.now ?? Date.now;
  }

  // ------------------------------------------------------------ public API

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OutboxEntry[] => this.entries;

  async start(): Promise<void> {
    await this.recoverInterruptedSends();
    await this.reload();
    window.addEventListener('online', this.kick);
    document.addEventListener('visibilitychange', this.kick);
    this.channel?.addEventListener('message', () => void this.reload());
    this.timer = setInterval(this.kick, TICK_MS);
    this.kick();
  }

  stop(): void {
    window.removeEventListener('online', this.kick);
    document.removeEventListener('visibilitychange', this.kick);
    if (this.timer) clearInterval(this.timer);
  }

  /** Saves a new transmission. The idempotency key is generated HERE, once. */
  async enqueue(submission: ActaSubmission, photo: Blob): Promise<OutboxEntry> {
    const now = this.now();
    const entry: OutboxEntry = {
      idempotencyKey: crypto.randomUUID(),
      submission,
      photo,
      state: 'QUEUED',
      attempts: 0,
      nextAttemptAt: now,
      photoState: 'PENDING',
      photoAttempts: 0,
      photoNextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.save(entry);
    this.kick();
    return entry;
  }

  /** Forces every queued item to be attempted now (button "Reintentar ahora"). */
  async retryNow(): Promise<void> {
    for (const entry of await outboxStore.list()) {
      if (entry.state === 'QUEUED') await outboxStore.put({ ...entry, nextAttemptAt: 0 });
      if (entry.state === 'DELIVERED' && entry.photoState === 'PENDING') {
        await outboxStore.put({ ...entry, photoNextAttemptAt: 0 });
      }
    }
    await this.reload();
    this.kick();
  }

  kick = (): void => {
    if (this.running) {
      this.rerun = true;
      return;
    }
    void this.dispatch();
  };

  // ------------------------------------------------------------ dispatching

  private async dispatch(): Promise<void> {
    this.running = true;
    try {
      do {
        this.rerun = false;
        // Only one tab delivers at a time; the others just display.
        if (navigator.locks) {
          await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
            if (lock) await this.deliverDue();
          });
        } else {
          await this.deliverDue();
        }
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  private async deliverDue(): Promise<void> {
    if (!navigator.onLine) return;
    const token = this.options.getToken();
    const now = this.now();
    // Oldest first: corrections must not overtake the original.
    const due = (await outboxStore.list()).reverse();
    for (const entry of due) {
      if (entry.state === 'QUEUED' && entry.nextAttemptAt <= now) await this.deliver(entry, token);
    }
    for (const entry of await outboxStore.list()) {
      if (entry.state === 'DELIVERED' && entry.photoState === 'PENDING' && entry.photoNextAttemptAt <= now) {
        await this.deliverPhoto(entry, token);
      }
    }
  }

  private async deliver(entry: OutboxEntry, token: string | null): Promise<void> {
    await this.save({ ...entry, state: 'SENDING' });
    const attempts = entry.attempts + 1;
    try {
      const outcome = await submitActa(token, entry.submission, entry.idempotencyKey);
      this.sessionExpired = outcome.kind === 'unauthorized';
      switch (outcome.kind) {
        case 'receipt':
          return this.save({
            ...entry,
            state: 'DELIVERED',
            receipt: outcome.receipt,
            attempts,
            lastError: undefined,
            photoState: outcome.receipt.result === 'OBSOLETE' ? 'SKIPPED' : 'PENDING',
          });
        case 'retry':
          return this.scheduleRetry(entry, attempts, outcome.code, outcome.retryAfterMs);
        case 'unauthorized':
          return this.save({ ...entry, state: 'QUEUED', lastError: 'SESSION_EXPIRED', nextAttemptAt: this.now() + UNAUTHORIZED_RETRY_MS });
        case 'rejected':
          return this.save({ ...entry, state: 'FAILED', attempts, lastError: outcome.code, photoState: 'SKIPPED' });
      }
    } catch (error) {
      const code = error instanceof TimeoutError ? 'TIMEOUT' : error instanceof NetworkError ? 'OFFLINE' : 'ERROR';
      return this.scheduleRetry(entry, attempts, code);
    }
  }

  private scheduleRetry(entry: OutboxEntry, attempts: number, code: string, minDelayMs = 0): Promise<void> {
    const delay = Math.max(minDelayMs, backoffDelay(attempts));
    return this.save({ ...entry, state: 'QUEUED', attempts, lastError: code, nextAttemptAt: this.now() + delay });
  }

  private async deliverPhoto(entry: OutboxEntry, token: string | null): Promise<void> {
    const photoAttempts = entry.photoAttempts + 1;
    let outcome: Awaited<ReturnType<typeof uploadPhoto>>;
    try {
      outcome = await uploadPhoto(token, entry.submission.actaId, entry.submission.version, entry.photo);
    } catch {
      outcome = 'retry';
    }
    if (outcome === 'stored') return this.save({ ...entry, photoState: 'UPLOADED', photoAttempts });
    if (outcome === 'rejected') return this.save({ ...entry, photoState: 'SKIPPED', photoAttempts });
    return this.save({
      ...entry,
      photoAttempts,
      photoNextAttemptAt: this.now() + backoffDelay(photoAttempts, { capMs: 60_000 }),
    });
  }

  // ------------------------------------------------------------ persistence

  /** A tab closed mid-request leaves SENDING entries: resend them (same key → harmless). */
  private async recoverInterruptedSends(): Promise<void> {
    for (const entry of await outboxStore.list()) {
      if (entry.state === 'SENDING') await outboxStore.put({ ...entry, state: 'QUEUED', nextAttemptAt: 0 });
    }
  }

  private async save(entry: OutboxEntry): Promise<void> {
    await outboxStore.put({ ...entry, updatedAt: this.now() });
    await this.reload();
    this.channel?.postMessage('changed');
  }

  private async reload(): Promise<void> {
    this.entries = await outboxStore.list();
    for (const listener of this.listeners) listener();
  }
}
