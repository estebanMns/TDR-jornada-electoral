import { request, type IncomingMessage } from 'node:http';
import { request as requestTls } from 'node:https';

export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

export interface RawSseOptions {
  url: string;
  lastEventId?: string | null;
  onOpen?: (response: IncomingMessage) => void;
  onFrame: (frame: SseFrame) => void;
  /** Called once when the connection ends for any reason. */
  onClose: (reason: string) => void;
}

/**
 * Minimal SSE client over raw http (no EventSource): cheap enough to open tens
 * of thousands per process, and it measures exactly what the server sends.
 */
export function openSse({ url, lastEventId, onOpen, onFrame, onClose }: RawSseOptions): () => void {
  const target = new URL(url);
  if (lastEventId) target.searchParams.set('lastEventId', lastEventId);
  const send = target.protocol === 'https:' ? requestTls : request;
  let closed = false;
  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    onClose(reason);
  };

  const req = send(target, { headers: { Accept: 'text/event-stream' }, agent: false }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      finish(`http-${res.statusCode}`);
      return;
    }
    onOpen?.(res);
    res.setEncoding('utf8');
    let buffer = '';
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const frame: SseFrame = { data: '' };
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) frame.id = line.slice(4);
          else if (line.startsWith('event: ')) frame.event = line.slice(7);
          else if (line.startsWith('data: ')) frame.data += line.slice(6);
        }
        if (frame.data) onFrame(frame);
      }
    });
    res.on('end', () => finish('end'));
    res.on('close', () => finish('close'));
  });
  req.on('error', (error) => finish(`error:${(error as NodeJS.ErrnoException).code ?? error.message}`));
  req.end();
  return () => {
    req.destroy();
    finish('local');
  };
}
