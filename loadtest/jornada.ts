/**
 * Election-day profile for the jurors (RT-8): 6.400 tables, 55 % of the actas
 * in the first 40 minutes with bursts of up to 300/min, 4–11 % resends with the
 * SAME idempotency key, ~180 corrections (version 2) and 6–9 % doubtful actas.
 *
 *   JWT_SECRET=… pnpm load:jornada --url https://<dominio> --acelerar 10
 *
 * Options: --url, --acelerar (time compression), --duracion-min (simulated day, 120),
 *          --mesas (limit, default all), --concurrencia (in-flight requests, 200), --csv.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  CANDIDATE_IDS,
  SPECIAL_VOTE_IDS,
  VOTE_OPTION_IDS,
  type ActaSubmission,
  type Catalog,
  type CatalogTable,
  type Votes,
} from '@electoral/shared';
import catalogJson from '../packages/shared/catalog.json';
import { devJurorPayload, devSecret, signDevToken } from '../scripts/lib/devToken';
import { fmt, percentile, writeCsv } from './lib/stats';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    acelerar: { type: 'string', default: '10' },
    'duracion-min': { type: 'string', default: '120' },
    mesas: { type: 'string', default: '0' },
    concurrencia: { type: 'string', default: '200' },
    csv: { type: 'string', default: '' },
  },
});

const SPEEDUP = Number(values.acelerar);
const DAY_MIN = Number(values['duracion-min']);
const catalog = catalogJson as unknown as Catalog;
const tables = Number(values.mesas) > 0 ? catalog.tables.slice(0, Number(values.mesas)) : catalog.tables;
const MINUTE = 60_000;
const between = (min: number, max: number) => min + Math.random() * (max - min);

/* ----------------------------------------------------------- schedule */

interface Planned {
  at: number; // simulated ms since the start
  table: CatalogTable;
  submission: ActaSubmission;
  idempotencyKey: string;
  kind: 'first' | 'resend' | 'correction';
}

function balancedVotes(voters: number): Votes {
  const votes = Object.fromEntries(VOTE_OPTION_IDS.map((o) => [o, 0])) as Votes;
  for (let i = 0; i < voters; i++) {
    const option = Math.random() < 0.9 ? CANDIDATE_IDS[Math.floor(Math.random() * 5)]! : SPECIAL_VOTE_IDS[Math.floor(Math.random() * 3)]!;
    votes[option] += 1;
  }
  return votes;
}

function submissionFor(table: CatalogTable, version: number, doubtful: boolean): ActaSubmission {
  const voters = Math.floor(between(0.5, 0.85) * table.enabled);
  return {
    actaId: table.actaId,
    version,
    tableId: table.id,
    votes: balancedVotes(voters),
    voters: doubtful ? voters + 1 : voters, // doubtful = does not balance
    photoHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
  };
}

/** First-report minute of every table: 55 % in the first 40 min (with bursts ≤ 300/min). */
function firstReportMinutes(count: number): number[] {
  const early = Math.round(count * 0.55);
  const perMinute = new Array<number>(DAY_MIN).fill(0);
  const bursts = [8, 15, 22, 31].filter((m) => m < Math.min(40, DAY_MIN));
  let left = early;
  for (const minute of bursts) {
    const size = Math.min(300, Math.round(early * 0.08), left);
    perMinute[minute]! += size;
    left -= size;
  }
  for (let i = 0; i < left; i++) perMinute[Math.floor(Math.random() * Math.min(40, DAY_MIN))]! += 1;
  for (let i = 0; i < count - early; i++) perMinute[40 + Math.floor(Math.random() * Math.max(1, DAY_MIN - 40))]! += 1;
  for (let m = 0; m < DAY_MIN; m++) {
    const extra = perMinute[m]! - 300; // hard cap of the profile
    if (extra > 0 && m + 1 < DAY_MIN) {
      perMinute[m] = 300;
      perMinute[m + 1]! += extra;
    }
  }
  return perMinute.flatMap((n, minute) => new Array<number>(n).fill(minute));
}

function buildPlan(): Planned[] {
  const minutes = firstReportMinutes(tables.length).sort(() => Math.random() - 0.5);
  const doubtfulRate = between(0.06, 0.09);
  const resendRate = between(0.04, 0.11);
  const corrections = Math.min(180, Math.round(tables.length * 0.028));
  const plan: Planned[] = [];

  tables.forEach((table, i) => {
    const at = (minutes[i]! + Math.random()) * MINUTE;
    const first: Planned = {
      at,
      table,
      submission: submissionFor(table, 1, Math.random() < doubtfulRate),
      idempotencyKey: randomUUID(),
      kind: 'first',
    };
    plan.push(first);
    if (Math.random() < resendRate) plan.push({ ...first, at: at + between(1, 30) * 1_000, kind: 'resend' });
  });
  for (const table of [...tables].sort(() => Math.random() - 0.5).slice(0, corrections)) {
    const original = plan.find((p) => p.table === table && p.kind === 'first')!;
    plan.push({
      at: Math.min(DAY_MIN * MINUTE - 1, original.at + between(5, 60) * MINUTE),
      table,
      submission: submissionFor(table, 2, false),
      idempotencyKey: randomUUID(),
      kind: 'correction',
    });
  }
  console.info(
    `Plan: ${fmt(tables.length)} actas, ${fmt(plan.filter((p) => p.kind === 'resend').length)} reenvíos ` +
      `(${(resendRate * 100).toFixed(1)} %), ${corrections} correcciones, dudosas ${(doubtfulRate * 100).toFixed(1)} %`,
  );
  return plan.sort((a, b) => a.at - b.at);
}

/* ----------------------------------------------------------- run */

const results = new Map<string, number>();
const latencies: number[] = [];
const perMinute: (string | number)[][] = [];
let inFlight = 0;

async function send(item: Planned): Promise<void> {
  const token = signDevToken(devJurorPayload(item.table.id), devSecret());
  const started = performance.now();
  inFlight += 1;
  try {
    const response = await fetch(`${values.url}/api/actas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': item.idempotencyKey,
      },
      body: JSON.stringify(item.submission), // Node fetch keeps connections alive by default
    });
    const body = (await response.json().catch(() => ({}))) as { result?: string; error?: string };
    const key = `${item.kind}:${body.result ?? body.error ?? response.status}`;
    results.set(key, (results.get(key) ?? 0) + 1);
  } catch (error) {
    const key = `${item.kind}:NETWORK_${(error as Error).name}`;
    results.set(key, (results.get(key) ?? 0) + 1);
  } finally {
    inFlight -= 1;
    latencies.push(performance.now() - started);
  }
}

async function main(): Promise<void> {
  const plan = buildPlan();
  const limit = Number(values.concurrencia);
  const startedAt = Date.now();
  let next = 0;
  let minuteStart = 0;
  let sentThisMinute = 0;

  console.info(`Simulando ${DAY_MIN} min en ${(DAY_MIN / SPEEDUP).toFixed(1)} min reales contra ${values.url}`);
  while (next < plan.length || inFlight > 0) {
    const simulated = (Date.now() - startedAt) * SPEEDUP;
    while (next < plan.length && plan[next]!.at <= simulated && inFlight < limit) {
      void send(plan[next++]!);
      sentThisMinute += 1;
    }
    if (simulated - minuteStart >= MINUTE) {
      const minute = Math.round(minuteStart / MINUTE);
      perMinute.push([minute, sentThisMinute, Math.round(percentile(latencies.slice(-sentThisMinute), 0.99))]);
      if (minute % 5 === 0) console.info(`  min ${minute}: ${sentThisMinute} envíos/min simulado, en vuelo ${inFlight}`);
      minuteStart += MINUTE;
      sentThisMinute = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  console.info('\nResultados (tipo:resultado → cantidad):');
  for (const [key, count] of [...results].sort()) console.info(`  ${key.padEnd(36)} ${fmt(count)}`);
  console.info(`Latencia HTTP p50 ${percentile(latencies, 0.5).toFixed(0)} ms · p99 ${percentile(latencies, 0.99).toFixed(0)} ms`);
  if (values.csv) writeCsv(values.csv, ['minuto', 'envios', 'lat_p99_ms'], perMinute);
}

void main();
