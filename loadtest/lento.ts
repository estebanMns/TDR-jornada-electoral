/**
 * RF-9 demo: a client that reads its socket very slowly. The server buffers for
 * it until 64 KB (then stops sending deltas: `lagging`), sends a `snapshot` when
 * it drains, and above 512 KB (or 30 s lagging) sends `reconnect` and closes.
 * The instance memory must stay flat (watch it on /ops).
 *
 *   pnpm fake-events --rate 100 --burst 300      # generate traffic
 *   pnpm load:lento --url http://localhost:3000 --bps 200 --clientes 20
 *
 * Options: --url, --topics (default dep,mun:1,mun:2), --bps (bytes read per second), --clientes, --duracion.
 */
import { connect, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { parseArgs } from 'node:util';
import { fmt } from './lib/stats';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    topics: { type: 'string', default: 'dep,mun:1,mun:2' },
    bps: { type: 'string', default: '1024' },
    clientes: { type: 'string', default: '1' },
    duracion: { type: 'string', default: '600' },
  },
});

const BYTES_PER_SECOND = Number(values.bps);
const target = new URL(values.url);

interface SlowClient {
  id: number;
  read: number;
  events: Record<string, number>;
  closedAt: number | null;
}

function startClient(id: number): SlowClient {
  const state: SlowClient = { id, read: 0, events: {}, closedAt: null };
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  // A tiny read buffer: once it is full the OS window closes and the SERVER has to buffer.
  const options = { host: target.hostname, port, readableHighWaterMark: 1024 };
  const socket: Socket =
    target.protocol === 'https:' ? connectTls({ ...options, servername: target.hostname }) : connect(options);

  socket.on('connect', () => socket.pause());
  socket.once(target.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
    socket.write(
      `GET /api/publico/stream?topics=${values.topics} HTTP/1.1\r\nHost: ${target.host}\r\nAccept: text/event-stream\r\n\r\n`,
    );
  });

  let text = '';
  const timer = setInterval(() => {
    // Paused mode: only `bps` bytes leave the kernel per second.
    let budget = BYTES_PER_SECOND;
    while (budget > 0) {
      const chunk = socket.read(Math.min(budget, 1024)) as Buffer | null;
      if (!chunk) break;
      budget -= chunk.length;
      state.read += chunk.length;
      text = (text + chunk.toString('utf8')).slice(-4_096);
      for (const match of text.matchAll(/event: (\w+)/g)) state.events[match[1]!] = (state.events[match[1]!] ?? 0) + 1;
      text = text.slice(text.lastIndexOf('\n') + 1);
    }
  }, 1_000);
  socket.on('close', () => {
    clearInterval(timer);
    state.closedAt = Date.now();
  });
  socket.on('error', () => {});
  return state;
}

const startedAt = Date.now();
const clients = Array.from({ length: Number(values.clientes) }, (_, i) => startClient(i));
console.info(`${clients.length} cliente(s) lento(s) leyendo ${fmt(BYTES_PER_SECOND)} B/s de ${values.topics}`);

const report = setInterval(() => {
  const closed = clients.filter((c) => c.closedAt).length;
  const events: Record<string, number> = {};
  for (const client of clients) for (const [e, n] of Object.entries(client.events)) events[e] = (events[e] ?? 0) + n;
  console.info(
    `t=${Math.round((Date.now() - startedAt) / 1_000)}s  leídos=${fmt(clients.reduce((n, c) => n + c.read, 0))} B  ` +
      `cerrados por el servidor=${closed}/${clients.length}  eventos=${JSON.stringify(events)}`,
  );
  if (closed === clients.length) {
    console.info('✔ El servidor cortó a todos los clientes lentos (RF-9): su memoria por conexión quedó acotada.');
    process.exit(0);
  }
}, 5_000);

setTimeout(() => {
  clearInterval(report);
  process.exit(0);
}, Number(values.duracion) * 1_000);
