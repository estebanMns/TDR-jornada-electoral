/**
 * Fake `ev:all` producer (owner: Evelyn). Lets the public page and the load
 * tests run WITHOUT the actas module, with the exact entry format of
 * `apply_acta.lua` (GENERAL §7.3): totals in `tot:*` and the absolute values
 * of the changed fields in `abs`, so snapshots and deltas stay consistent.
 *
 *   pnpm fake-events                         # ~5 events/s, a burst every 30 s
 *   pnpm fake-events --rate 50 --burst 200   # heavier traffic (e.g. for loadtest/lento.ts)
 *   pnpm fake-events --duration 60           # stop after 60 s
 *
 * Env: REDIS_URL. Use only against a TEST Redis: it writes tot:* and ev:all.
 */
import { parseArgs } from 'node:util';
import { Redis } from 'ioredis';
import {
  CANDIDATE_IDS,
  redisKeys,
  STREAM_LIMITS,
  VOTE_OPTION_IDS,
  type Catalog,
  type CatalogTable,
  type Votes,
} from '@electoral/shared';
import catalogJson from '../packages/shared/catalog.json';

const { values } = parseArgs({
  options: {
    rate: { type: 'string', default: '5' },
    'burst-every': { type: 'string', default: '30' },
    burst: { type: 'string', default: '60' },
    duration: { type: 'string', default: '0' },
    'correction-ratio': { type: 'string', default: '0.03' },
  },
});

const RATE = Number(values.rate);
const BURST_EVERY_S = Number(values['burst-every']);
const BURST_SIZE = Number(values.burst);
const DURATION_S = Number(values.duration);
const CORRECTION_RATIO = Number(values['correction-ratio']);

const catalog = catalogJson as unknown as Catalog;
const stationMun = new Map(catalog.stations.map((s) => [s.id, s.municipalityId]));
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

/**
 * Tables already reported, by this or a previous run: `tot:table:{id}` is the
 * marker (like apply_acta.lua), so every table reports ONCE and `_reported`
 * never exceeds the number of tables.
 */
const applied = new Set<number>();
let pending: CatalogTable[] = [];

function randomVotes(table: CatalogTable): { votes: Votes; voters: number } {
  const voters = 80 + Math.floor(Math.random() * Math.min(table.enabled - 80, 250));
  const votes = Object.fromEntries(VOTE_OPTION_IDS.map((o) => [o, 0])) as Votes;
  for (let i = 0; i < voters; i++) {
    const option = Math.random() < 0.92 ? CANDIDATE_IDS[Math.floor(Math.random() * 5)]! : VOTE_OPTION_IDS[5 + Math.floor(Math.random() * 3)]!;
    votes[option] += 1;
  }
  return { votes, voters };
}

/** Applies `delta` to the 3 public levels and writes ONE ev:all entry with the new absolute values. */
async function emit(table: CatalogTable, delta: Record<string, number>, type: 'APPLIED' | 'CORRECTION', version: number) {
  const mun = stationMun.get(table.stationId)!;
  const levels = [
    { topic: '', key: redisKeys.totalsTable(table.id) },
    { topic: `station:${table.stationId}`, key: redisKeys.totalsStation(table.stationId) },
    { topic: `mun:${mun}`, key: redisKeys.totalsMunicipality(mun) },
    { topic: 'dep', key: redisKeys.totalsDepartment() },
  ];
  const fields = Object.entries(delta).filter(([, amount]) => amount !== 0);
  const tx = redis.multi();
  for (const level of levels) for (const [field, amount] of fields) tx.hincrby(level.key, field, amount);
  const results = (await tx.exec()) ?? [];

  const abs: Record<string, Record<string, number>> = {};
  let index = 0;
  for (const level of levels) {
    if (!level.topic) {
      index += fields.length; // table level: not a public topic
      continue;
    }
    abs[level.topic] = {};
    for (const [field] of fields) abs[level.topic]![field] = Number(results[index++]![1]);
  }
  await redis.xadd(
    redisKeys.eventsAll(), 'MAXLEN', '~', STREAM_LIMITS.eventsAll, '*',
    'acta', table.actaId, 'version', version, 'type', type,
    'reason', type === 'APPLIED' ? 'FIRST_REPORT' : 'CORRECTION',
    'tsRx', Date.now(), 'table', table.id, 'station', table.stationId, 'mun', mun, 'abs', JSON.stringify(abs),
  );
}

async function nextEvent(): Promise<void> {
  const correct = applied.size > 0 && Math.random() < CORRECTION_RATIO;
  if (correct || pending.length === 0) {
    const tableId = [...applied][Math.floor(Math.random() * applied.size)]!;
    const table = catalog.tables[tableId - 1]!;
    const candidate = CANDIDATE_IDS[Math.floor(Math.random() * 5)]!;
    const current = Number(await redis.hget(redisKeys.totalsTable(tableId), candidate));
    const removed = Math.min(current, 5 + Math.floor(Math.random() * 20)); // a number goes DOWN
    if (removed === 0) return;
    await emit(table, { [candidate]: -removed, _voters: -removed }, 'CORRECTION', 2);
    return;
  }
  if (pending.length === 0 && applied.size === 0) throw new Error('Every table already reported: FLUSH the test Redis to start over');
  const table = pending.pop()!;
  const { votes, voters } = randomVotes(table);
  applied.add(table.id);
  await emit(table, { ...votes, _reported: 1, _voters: voters }, 'APPLIED', 1);
}

async function ensureTableCounts(): Promise<void> {
  // The seed loads these; set them only if missing so "% reported" works without it.
  const tx = redis.multi();
  tx.set(redisKeys.catalogDepartmentTableCount(), catalog.tables.length, 'NX');
  const perMun = new Map<number, number>();
  const perStation = new Map<number, number>();
  for (const table of catalog.tables) {
    perStation.set(table.stationId, (perStation.get(table.stationId) ?? 0) + 1);
    const mun = stationMun.get(table.stationId)!;
    perMun.set(mun, (perMun.get(mun) ?? 0) + 1);
  }
  for (const [id, n] of perMun) tx.set(redisKeys.catalogMunicipalityTableCount(id), n, 'NX');
  for (const [id, n] of perStation) tx.set(redisKeys.catalogStationTableCount(id), n, 'NX');
  await tx.exec();
}

async function loadReportedTables(): Promise<void> {
  const tx = redis.pipeline();
  for (const table of catalog.tables) tx.exists(redisKeys.totalsTable(table.id));
  const exists = (await tx.exec()) ?? [];
  catalog.tables.forEach((table, i) => (exists[i]![1] === 1 ? applied.add(table.id) : pending.push(table)));
  pending.sort(() => Math.random() - 0.5);
  console.info(`  ${applied.size} tables already reported, ${pending.length} pending`);
}

async function main(): Promise<void> {
  await ensureTableCounts();
  await loadReportedTables();
  const startedAt = Date.now();
  let sent = 0;
  let lastBurst = Date.now();
  console.info(`fake-events: ${RATE} ev/s, burst of ${BURST_SIZE} every ${BURST_EVERY_S} s`);

  while (DURATION_S === 0 || Date.now() - startedAt < DURATION_S * 1_000) {
    const tick = Date.now();
    let count = RATE;
    if (BURST_EVERY_S > 0 && tick - lastBurst >= BURST_EVERY_S * 1_000) {
      count += BURST_SIZE;
      lastBurst = tick;
    }
    for (let i = 0; i < count; i++) await nextEvent();
    sent += count;
    if (sent % 50 < count) console.info(`  ${sent} events (${applied.size} tables reported)`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1_000 - (Date.now() - tick))));
  }
  redis.disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
