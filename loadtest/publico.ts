/**
 * RT-8: N raw SSE connections against the public stream, split across
 * processes, with the audience topic mix. Measures receipt → client latency
 * (`now − tsRxMin` of every delta).
 *
 *   pnpm load:publico --url https://<dominio> --conexiones 20000 --procesos 4 --duracion 300
 *
 * Options: --url, --conexiones, --procesos, --rampa (connections/s per process),
 *          --duracion (s), --csv (file with one row per report).
 */
import { parseArgs } from 'node:util';
import { openSse } from './lib/sseClient';
import { fmt, percentile, Reservoir, writeCsv } from './lib/stats';
import { topicForClient } from './lib/topics';
import { forkWorkers, isWorker, workerIndex } from './lib/workers';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    conexiones: { type: 'string', default: '2000' },
    procesos: { type: 'string', default: '2' },
    rampa: { type: 'string', default: '500' },
    duracion: { type: 'string', default: '60' },
    csv: { type: 'string', default: '' },
    worker: { type: 'string' },
  },
});

const TOTAL = Number(values.conexiones);
const PROCESSES = Math.max(1, Number(values.procesos));
const RAMP = Number(values.rampa);
const DURATION_S = Number(values.duracion);

interface Report {
  open: number;
  opening: number;
  failed: number;
  rateLimited: number;
  reconnects: number;
  frames: number;
  bytes: number;
  latencies: number[];
}

/* ------------------------------------------------------------------ worker */

async function runWorker(): Promise<void> {
  const index = workerIndex();
  const mine = Math.floor(TOTAL / PROCESSES) + (index < TOTAL % PROCESSES ? 1 : 0);
  const report: Report = { open: 0, opening: 0, failed: 0, rateLimited: 0, reconnects: 0, frames: 0, bytes: 0, latencies: [] };
  const latencies = new Reservoir();
  const closers: (() => void)[] = [];

  const connect = (client: number, lastEventId: string | null = null) => {
    report.opening += 1;
    let lastId = lastEventId;
    const topic = topicForClient(client);
    closers[client] = openSse({
      url: `${values.url}/api/publico/stream?topics=${topic}`,
      lastEventId,
      onOpen: () => {
        report.opening -= 1;
        report.open += 1;
      },
      onFrame: (frame) => {
        report.frames += 1;
        report.bytes += frame.data.length;
        if (frame.id) lastId = frame.id;
        if (frame.event === 'delta') latencies.add(Date.now() - (JSON.parse(frame.data) as { tsRxMin: number }).tsRxMin);
      },
      onClose: (reason) => {
        if (reason === 'local') return;
        if (reason.startsWith('error') || reason.startsWith('http')) {
          report.opening -= 1;
          report.failed += 1;
          if (reason === 'http-429') report.rateLimited += 1;
        } else report.open -= 1;
        // Come back with the last id, after a jittered wait (like the real client).
        report.reconnects += 1;
        setTimeout(() => connect(client, lastId), Math.random() * 3_000);
      },
    });
  };

  for (let client = 0; client < mine; client++) {
    connect(index * 1_000_000 + client);
    if (client % RAMP === RAMP - 1) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const timer = setInterval(() => {
    report.latencies = latencies.drain();
    process.send?.(report);
    report.frames = 0;
    report.bytes = 0;
    report.reconnects = 0;
  }, 2_000);

  process.on('message', (message) => {
    if (message !== 'stop') return;
    clearInterval(timer);
    closers.forEach((close) => close?.());
    process.exit(0);
  });
}

/* ------------------------------------------------------------------ master */

function runMaster(): void {
  console.info(`SSE: ${fmt(TOTAL)} conexiones en ${PROCESSES} procesos contra ${values.url} (${DURATION_S} s)`);
  const workers = forkWorkers(import.meta.url, PROCESSES, process.argv.slice(2));
  const latest = new Map<number, Report>();
  const rows: (string | number)[][] = [];
  const startedAt = Date.now();

  workers.forEach((worker, index) => worker.on('message', (report: Report) => latest.set(index, report)));

  const print = setInterval(() => {
    const reports = [...latest.values()];
    const sum = (key: keyof Omit<Report, 'latencies'>) => reports.reduce((n, r) => n + r[key], 0);
    const latencies = reports.flatMap((r) => r.latencies);
    const row = {
      s: Math.round((Date.now() - startedAt) / 1_000),
      abiertas: sum('open'),
      abriendo: sum('opening'),
      fallidas: sum('failed'),
      rechazadas429: sum('rateLimited'),
      'mensajes/s': sum('frames') / 2,
      'KB/s': sum('bytes') / 2 / 1024,
      'reconexiones/s': sum('reconnects') / 2,
      'lat p50 ms': percentile(latencies, 0.5),
      'lat p99 ms': percentile(latencies, 0.99),
    };
    rows.push(Object.values(row));
    console.info(Object.entries(row).map(([k, v]) => `${k}=${fmt(v)}`).join('  '));
  }, 5_000);

  setTimeout(() => {
    clearInterval(print);
    for (const worker of workers) worker.send('stop');
    if (values.csv) {
      writeCsv(values.csv, ['s', 'abiertas', 'abriendo', 'fallidas', 'rate_limited', 'mensajes_s', 'kb_s', 'reconexiones_s', 'lat_p50', 'lat_p99'], rows);
      console.info(`CSV: ${values.csv}`);
    }
    setTimeout(() => process.exit(0), 500);
  }, DURATION_S * 1_000);
}

if (isWorker()) void runWorker();
else runMaster();
