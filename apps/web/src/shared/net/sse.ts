/**
 * SSE client with MANUAL reconnection (owner: Evelyn, GENERAL §9.2/§9.4).
 *
 * Native EventSource retries on its own with a fixed delay: when an instance
 * dies, every browser comes back at the same moment (avalanche). Here, on
 * `error` the source is closed and reopened after a full-jitter backoff,
 * passing the last id in `?lastEventId=` so the server replays what was missed.
 */
import { backoffDelay } from './backoff';

export type SseState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SseClientOptions {
  /** Builds the URL; receives the last id seen (null the first time). */
  url: (lastEventId: string | null) => string;
  /** Handlers per SSE event name; `data` is already parsed JSON. */
  handlers: Record<string, (data: unknown, id: string | null) => void>;
  onState?: (state: SseState) => void;
  /** Event the server sends to ask for a reconnection (`reconnect`). */
  reconnectEvent?: string;
  delay?: (attempt: number) => number;
}

export class SseClient {
  private source: EventSource | null = null;
  private lastEventId: string | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly onOnline = () => {
    // Network is back: no reason to wait for the rest of the backoff.
    if (this.timer) this.reconnectNow();
  };

  constructor(private readonly options: SseClientOptions) {}

  get lastId(): string | null {
    return this.lastEventId;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    window.addEventListener('online', this.onOnline);
    this.connect('connecting');
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener('online', this.onOnline);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
    this.options.onState?.('closed');
  }

  private connect(state: SseState): void {
    this.options.onState?.(state);
    const source = new EventSource(this.options.url(this.lastEventId));
    this.source = source;

    source.onopen = () => {
      this.attempt = 0;
      this.options.onState?.('open');
    };
    source.onerror = () => this.scheduleReconnect();

    for (const [event, handler] of Object.entries(this.options.handlers)) {
      source.addEventListener(event, (message) => {
        const { data, lastEventId } = message as MessageEvent<string>;
        if (lastEventId) this.lastEventId = lastEventId;
        handler(JSON.parse(data), lastEventId || null);
      });
    }
    source.addEventListener(this.options.reconnectEvent ?? 'reconnect', () => this.scheduleReconnect());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    this.source?.close();
    this.source = null;
    this.options.onState?.('reconnecting');
    const wait = (this.options.delay ?? backoffDelay)(this.attempt++);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect('reconnecting');
    }, wait);
  }

  private reconnectNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.stopped) this.connect('reconnecting');
  }
}
