/**
 * RF-10 avalanche: N clients connected; an instance is stopped
 * (`docker stop preconteo-app3-1`) and its clients reconnect. With jitter
 * (full jitter backoff) the reconnections spread out; without it (fixed delay,
 * like native EventSource) they arrive as one spike. Exports a CSV for the report.
 *
 *   pnpm load:avalancha --url https://<dominio> --clientes 10000 --jitter on  --csv avalancha-on.csv
 *   pnpm load:avalancha --url https://<dominio> --clientes 10000 --jitter off --csv avalancha-off.csv
 *   # while it runs (after "listo"): docker stop preconteo-app3-1
 *
 * Options: --url, --clientes, --procesos, --jitter on|off, --duracion, --csv.
 */
import { parseArgs } from 'node:util';
import { openSse } from './lib/sseClient';
import { fmt, writeCsv } from './lib/stats';
import { forkWorkers, isWorker, workerIndex } from './lib/workers';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    clientes: { type: 'string', default: '2000' },
    procesos: { type: 'string', default: '2' },
    jitter: { type: 'string', default: 'on' },
    /** First backoff window in ms (GENERAL: 500). Try 5000 to compare. */
    'base-ms': { type: 'string', default: '500' },
    duracion: { type: 'string', default: '120' },
    csv: { type: 'string', default: '' },
    worker: { type: 'string' },
  },
});

const WITH_JITTER = values.jitter !== 'off';
const PROCESSES = Math.max(1, Number(values.procesos));
const TOTAL = Number(values.clientes);

/** Same formula as `apps/web/src/shared/net/backoff.ts`. */
const BASE_MS = Number(values['base-ms']);
const fullJitter = (attempt: number) => Math.floor(Math.random() * Math.min(30_000, BASE_MS * 2 ** attempt));
/** Time bucket: 100 ms (1 s bins hide a spike that lasts half a second). */
const BUCKET_MS = 100;
const bucketOf = (ms: number) => Math.floor(ms / BUCKET_MS);
const fixedDelay = () => 1_000;

function runWorker(): void {
  const mine = Math.floor(TOTAL / PROCESSES);
  const attemptsPerSecond = new Map<number, number>();
  let connected = 0;

  const connect = (attempt: number, lastId: string | null) => {
    const bucket = bucketOf(Date.now());
    if (attempt > 0) attemptsPerSecond.set(bucket, (attemptsPerSecond.get(bucket) ?? 0) + 1);
    let id = lastId;
    openSse({
      url: `${values.url}/api/publico/stream?topics=dep`,
      lastEventId: lastId,
      onOpen: () => {
        connected += 1;
        attempt = 0;
      },
      onFrame: (frame) => {
        if (frame.id) id = frame.id;
      },
      onClose: (reason) => {
        if (!reason.startsWith('error') && !reason.startsWith('http')) connected -= 1;
        const wait = WITH_JITTER ? fullJitter(attempt) : fixedDelay();
        setTimeout(() => connect(attempt + 1, id), wait);
      },
    });
  };

  for (let i = 0; i < mine; i++) setTimeout(() => connect(0, null), (i / mine) * 5_000);
  setInterval(() => {
    process.send?.({ connected, attempts: Object.fromEntries(attemptsPerSecond) });
    attemptsPerSecond.clear();
  }, 1_000);
  process.on('message', (m) => m === 'stop' && process.exit(0));
}

function runMaster(): void {
  console.info(
    `Avalancha: ${fmt(TOTAL)} clientes, jitter ${WITH_JITTER ? `ON (full jitter, base ${BASE_MS} ms)` : 'OFF (1 s fijo)'}`,
  );
  const workers = forkWorkers(import.meta.url, PROCESSES, process.argv.slice(2));
  const reconnections = new Map<number, number>();
  const connected = new Map<number, number>();
  const startedAt = bucketOf(Date.now());
  let announced = false;

  workers.forEach((worker, index) =>
    worker.on('message', ({ connected: c, attempts }: { connected: number; attempts: Record<string, number> }) => {
      connected.set(index, c);
      for (const [second, n] of Object.entries(attempts)) reconnections.set(Number(second), (reconnections.get(Number(second)) ?? 0) + n);
    }),
  );

  const print = setInterval(() => {
    const now = bucketOf(Date.now());
    const total = [...connected.values()].reduce((a, b) => a + b, 0);
    let lastSecond = 0;
    for (let b = now - 10; b < now; b++) lastSecond += reconnections.get(b) ?? 0;
    if (!announced && total >= TOTAL * 0.95) {
      announced = true;
      console.info('✔ listo: ahora detén una instancia (docker stop preconteo-app3-1)');
    }
    console.info(`t=${Math.round(((now - startedAt) * BUCKET_MS) / 1_000)}s conectados=${fmt(total)} reconexiones/s=${fmt(lastSecond)}`);
  }, 1_000);

  setTimeout(() => {
    clearInterval(print);
    workers.forEach((w) => w.send('stop'));
    const end = bucketOf(Date.now());
    const rows: number[][] = [];
    for (let b = startedAt; b <= end; b++) rows.push([((b - startedAt) * BUCKET_MS) / 1_000, reconnections.get(b) ?? 0]);
    const peak = Math.max(...rows.map((r) => r[1]!));
    const total = rows.reduce((n, r) => n + r[1]!, 0);
    console.info(
      `Pico: ${fmt(peak)} reconexiones en 100 ms (≈ ${fmt(peak * 10)}/s) · total de intentos: ${fmt(total)} (jitter ${values.jitter})`,
    );
    if (values.csv) {
      writeCsv(values.csv, ['segundo', 'reconexiones_100ms'], rows);
      console.info(`CSV: ${values.csv}`);
    }
    setTimeout(() => process.exit(0), 300);
  }, Number(values.duracion) * 1_000);
}

if (isWorker()) runWorker();
else runMaster();
