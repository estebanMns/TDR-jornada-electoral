import { backoffDelay } from './backoff';

export type SseStatus = 'live' | 'reconnecting' | 'paused';
export type SseMessage = { id?: string; event: string; data: any };
type Options = { url: string; onMessage: (message: SseMessage) => void; onStatus?: (status: SseStatus) => void; signal?: AbortSignal };

export function connectSse({ url, onMessage, onStatus, signal }: Options) {
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, attempt = 0, lastId = '';
  const close = () => { stopped = true; source?.close(); if (timer) clearTimeout(timer); };
  const schedule = () => {
    if (stopped || timer) return;
    onStatus?.('reconnecting');
    timer = setTimeout(() => { timer = undefined; attempt++; connect(); }, backoffDelay(attempt));
  };
  const connect = () => {
    if (stopped || signal?.aborted) return;
    const target = new URL(url, window.location.origin);
    if (lastId) target.searchParams.set('lastEventId', lastId);
    source = new EventSource(target);
    source.onopen = () => { attempt = 0; onStatus?.('live'); };
    const handle = (event: MessageEvent) => {
      if (event.lastEventId) lastId = event.lastEventId;
      let data: any = event.data;
      try { data = JSON.parse(event.data); } catch {}
      onMessage({ id: event.lastEventId || undefined, event: event.type, data });
      if (event.type === 'estado') onStatus?.(data.pausado ? 'paused' : 'live');
      if (event.type === 'reconectar') { source?.close(); schedule(); }
    };
    ['snapshot', 'delta', 'estado', 'reconectar'].forEach(type => source!.addEventListener(type, handle as EventListener));
    source.onerror = () => { source?.close(); schedule(); };
  };
  signal?.addEventListener('abort', close, { once: true });
  connect();
  return close;
}
