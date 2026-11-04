/**
 * Single source of every Redis key (GENERAL §8). Nobody writes a key by hand.
 * Only one Redis node is used, so no Cluster hash tags are needed.
 */
export const redisKeys = {
  // --- Ingestion (owner: actas) ---
  idempotency: (key: string) => `idem:${key}`,
  acta: (actaId: string) => `acta:${actaId}`,
  actaVersion: (actaId: string, version: number) => `acta:${actaId}:v:${version}`,
  jurorActas: (jurorSub: string) => `juror:${jurorSub}:actas`,

  // --- Accumulated totals (HASH option -> votes, plus `_reported`, `_voters`) ---
  totalsTable: (tableId: number) => `tot:table:${tableId}`,
  totalsStation: (stationId: number) => `tot:station:${stationId}`,
  totalsMunicipality: (municipalityId: number) => `tot:mun:${municipalityId}`,
  totalsDepartment: () => 'tot:dep',

  // --- Rankings (ZSET candidate -> votes) ---
  rankStation: (stationId: number) => `rank:station:${stationId}`,
  rankMunicipality: (municipalityId: number) => `rank:mun:${municipalityId}`,
  rankDepartment: () => 'rank:dep',

  // --- Streams ---
  /** Backplane + public history (RF-4/RF-6). */
  eventsAll: () => 'ev:all',
  /** Deferred persistence to Supabase (consumer group `persist`). */
  eventsActas: () => 'ev:actas',

  // --- Verification (actas writes cases, verification module manages them) ---
  verificationQueue: () => 'verif:queue',
  verificationCase: (actaId: string) => `verif:case:${actaId}`,
  verificationTaken: () => 'verif:taken',
  verificationLock: (actaId: string) => `lock:acta:${actaId}`,
  fencingSequence: () => 'fence:seq',

  // --- Catalog (loaded by `pnpm seed`) ---
  catalogTable: (tableId: number) => `cat:table:${tableId}`,
  catalogStationTableCount: (stationId: number) => `cat:n:station:${stationId}`,
  catalogMunicipalityTableCount: (municipalityId: number) => `cat:n:mun:${municipalityId}`,
  catalogDepartmentTableCount: () => 'cat:n:dep',

  // --- Platform ---
  presence: (sub: string) => `presence:${sub}`,
  presenceIndex: () => 'presence:idx',
  rateLimit: (credential: string, window: number) => `rl:${credential}:${window}`,
  instanceMetrics: (instanceId: string) => `metrics:inst:${instanceId}`,
  metricsInstances: () => 'metrics:instances',
} as const;

/** Pub/Sub channels (ephemeral notifications; no history needed). */
export const redisChannels = {
  verification: 'ch:verif',
  presence: 'ch:presence',
} as const;

/** Consumer group of the persistence worker on `ev:actas`. */
export const PERSISTENCE_CONSUMER_GROUP = 'persist';

/** Stream retention (approximate MAXLEN). */
export const STREAM_LIMITS = {
  eventsAll: 50_000,
  eventsActas: 20_000,
} as const;
