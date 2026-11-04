import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import type { ClientConnection } from './clientConnection';

let sequence = 0;

export interface SseFrame {
  id?: string;
  event?: string;
  data: unknown;
}

/** Serializes one SSE frame. Called once per batch; the string is shared by every connection. */
export function formatSseFrame({ id, event, data }: SseFrame): string {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  let frame = '';
  if (id) frame += `id: ${id}\n`;
  if (event) frame += `event: ${event}\n`;
  for (const line of text.split('\n')) frame += `data: ${line}\n`;
  return `${frame}\n`;
}

export interface SseConnectionOptions {
  /** Client reconnection delay sent in the first `retry:` line. */
  retryMs: number;
  headers?: Record<string, string>;
  /** Event used by `close()` to ask the client to come back. */
  closeEvent?: string;
}

/**
 * SSE over the raw Node response (the route must `reply.hijack()` first).
 * Uses `writableLength` and `drain`, which framework stream helpers hide.
 */
export class SseConnection implements ClientConnection {
  readonly id = `sse-${++sequence}`;
  readonly kind = 'sse' as const;
  readonly openedAt = Date.now();
  private readonly events = new EventEmitter();
  private open = true;

  constructor(
    private readonly response: ServerResponse,
    private readonly options: SseConnectionOptions,
  ) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...options.headers,
    });
    response.socket?.setNoDelay(true);
    response.on('drain', () => this.events.emit('drain'));
    response.on('close', () => this.markClosed());
    response.write(`retry: ${options.retryMs}\n\n`);
  }

  get isOpen(): boolean {
    return this.open;
  }

  send(frame: string): boolean {
    if (!this.open) return false;
    return this.response.write(frame);
  }

  /** SSE comment: keeps proxies from closing an idle connection. */
  ping(): void {
    this.send(': ping\n\n');
  }

  bufferedBytes(): number {
    return this.response.writableLength;
  }

  close(reason: string): void {
    if (!this.open) return;
    this.response.end(formatSseFrame({ event: this.options.closeEvent ?? 'reconnect', data: { reason } }));
    this.markClosed();
  }

  onDrain(listener: () => void): () => void {
    this.events.on('drain', listener);
    return () => this.events.off('drain', listener);
  }

  onClose(listener: () => void): () => void {
    if (!this.open) {
      queueMicrotask(listener);
      return () => {};
    }
    this.events.once('close', listener);
    return () => this.events.off('close', listener);
  }

  private markClosed(): void {
    if (!this.open) return;
    this.open = false;
    this.events.emit('close');
    this.events.removeAllListeners();
  }
}
