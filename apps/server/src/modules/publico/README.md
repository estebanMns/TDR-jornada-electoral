# publico — live results for up to 400.000 browsers (owner: Evelyn)

RF-4, RF-5, RF-6, RF-9, RF-10 (public side). Transport: **SSE**.

```
publico.routes.ts      HTTP/SSE: validation, rate limit, mapping to the service
publico.service.ts     orchestration: reader → window → fan-out; catch-up; paused state
streamReader.ts        XREAD BLOCK over ev:all with its own cursor (dedicated connection)
windowAggregator.ts    merges absolute values per topic during WINDOW_MS
topicRegistry.ts       topic → Set<subscriber> (O(1) add/remove, O(subscribers) send)
broadcaster.ts         fan-out of a window: serialize once, batches of 500, yield
backpressure.ts        BackpressurePolicy (Strategy) + ThresholdBackpressurePolicy
resumePlanner.ts       RF-6: replay (one merged delta) or snapshot
publico.repository.ts  the only file that knows Redis keys (snapshot.lua, XRANGE, vitals)
vitals.service.ts      INP samples → p75 gauge
lua/snapshot.lua       totals + table count + last stream id, atomically
```

## HTTP

| Route | Answer |
|---|---|
| `GET /api/publico/stream?topics=dep,mun:11` (≤ 3 topics) | SSE. `Last-Event-ID` header or `?lastEventId=`. 400 bad topics; 429 + `Retry-After` over `PUBLIC_STREAM_OPENS_PER_MIN` per IP |
| `GET /api/publico/snapshot?topic=mun:11` | `PublicSnapshot` JSON; 503 if Redis is down |
| `POST /api/vitals` `{ name: 'INP', value }` (JSON or text/plain from `sendBeacon`) | 204 |

SSE events (types in `@electoral/shared` → `publicStream.ts`):

| event | data | id |
|---|---|---|
| `snapshot` | `{ id, topic, totals, tables: { reported, total } }` | last `ev:all` id |
| `delta` | `{ topic, changes, reasons[], tsRxMin }` — **absolute** values of the changed fields | window id (same for every topic of a window) |
| `status` | `{ paused: true, since }` / `{ paused: false }` | — |
| `reconnect` | `{ reason }` — the server asks the client to come back with its id | — |

## How it works

1. **One global stream** (`ev:all`). Each instance reads ALL of it (`XREAD BLOCK 1000`) from a
   concrete id (never `$`), so after a Redis outage it resumes exactly where it stopped.
2. **Window** of `WINDOW_MS` (2 s): per topic, last value wins. A topic with 80 events in a
   window produces ONE message.
3. **Fan-out**: the message of a topic is serialized once and written to its subscribers only,
   in batches of 500 with `setImmediate` between batches. A subscriber whose `lastId` is already
   ≥ the window id is skipped (it got it through replay).
4. **Continuity (RF-6)**: with a known id → `XRANGE (id +` filtered by topic → one merged delta
   per topic. **Snapshot** when there is no id, the id is not in the stream (trimmed or invented),
   more than 2.000 events are pending or the id is older than 10 min. While a client catches up,
   live windows are held back for it; if one was missed, it replays again from where it got to.
5. **Backpressure (RF-9)** before every send: `bufferedBytes() > 64 KB` → lagging (no deltas);
   on `drain` → snapshot and live again. `> 512 KB` or lagging > 30 s → `reconnect` + close.
6. **Redis down (RF-10)**: every client gets `status {paused:true, since}` and keeps the last
   data; on recovery `status {paused:false}` and the reader continues from its cursor.
7. **Shutdown**: `preClose` sends `reconnect` to every client before the socket closes.

## Measurements (for the report)

| What | Result | Source |
|---|---|---|
| Fan-out 50.000 connections, 10 windows × 40 events | Event Loop **p99 6,1 ms / max 16,7 ms** in batches of 500 vs **p99 70,5 ms** in one loop | `test/publico.fanout.test.ts` |
| Real vs naive messages (same run) | **475.555 vs 20.000.000** (×42 fewer) | idem |
| 20.000 SSE connections, one instance (local) | 19.966 open (fd limit of the sandbox = 20.000), receipt→client latency p99 ≈ 2,0 s with `WINDOW_MS=2000` | `loadtest/publico.ts` |
| Bandwidth per public client | ≈ **0,5 KB/s** (one topic, realistic profile) | `curl` of the stream |
| Juror profile, 400 tables (×240) | 0 errors, every resend `ALREADY_REGISTERED`, HTTP p99 10 ms | `loadtest/jornada.ts` |
| Avalanche, 4.000 clients dropped at once | peak per 100 ms: **1.625** fixed 1 s · **1.024** full jitter base 500 ms · **163** full jitter base 5 s | `loadtest/avalancha.ts` |

Findings worth discussing in the report:

- **Full jitter with base 500 ms (GENERAL §9.4) barely flattens a mass disconnection**: the first
  window (0–500 ms) is too short to de-synchronize thousands of clients. The public page uses a
  5 s first window (`PUBLIC_BACKOFF_BASE_MS`), 10× lower peak and half the attempts.
  `shared/net/backoff.ts` keeps the GENERAL formula (the juror outbox also uses it).
- **A "1 KB/s" client is not slow here**: windows keep each connection at ~0,5 KB/s. RF-9 only
  triggers for clients that practically stop reading, and only after the OS socket buffers
  (several MB on Linux) are full. The policy itself is tested with simulated buffers.
- **30 stream opens per IP per minute** (GENERAL §7.1) also limits legitimate users behind mobile
  CGNAT (many phones, one public IP). Configurable: `PUBLIC_STREAM_OPENS_PER_MIN`.

## Running

```bash
pnpm --filter @electoral/server test       # needs redis-test on :6380
pnpm seed --no-supabase && pnpm dev:server
pnpm fake-events                            # ev:all without the actas module
curl -N "localhost:3000/api/publico/stream?topics=dep"
```
