# Load tests (owner: Evelyn) — RT-8, RF-9, RF-10

Run them **from another machine** than the server (same machine = the client competes
for CPU and ports). Each script prints a table every few seconds and can export a CSV.

## Before running

```bash
ulimit -n 200000                      # every SSE connection is a file descriptor
pnpm install
export URL=https://preconteo-xxx.duckdns.org
```

On the server, raise the per-IP limit of stream opens: the load test comes from ONE IP
(`.env`: `PUBLIC_STREAM_OPENS_PER_MIN=1000000`, then `./infra/deploy.sh`). Otherwise you get 429.

One process tops out at ~25.000–30.000 sockets (ephemeral ports); use `--procesos`.
For more than ~60.000 connections, use a second client machine.

## 1. Public audience — `publico.ts` (RT-8: ≥ 20.000, goal 50.000)

```bash
pnpm load:publico --url $URL --conexiones 20000 --procesos 4 --rampa 1000 --duracion 300 --csv publico.csv
```

Topic mix 60 % `dep`, 35 % municipality, 5 % station. Columns: open / opening / failed /
`rechazadas429`, messages/s, KB/s, reconnections/s, latency `now − tsRxMin` p50/p99.
Watch `/ops` at the same time (connections per instance, Event Loop p99, memory per connection).

## 2. Election day — `jornada.ts`

```bash
JWT_SECRET=<same as the server> pnpm load:jornada --url $URL --acelerar 10 --csv jornada.csv
```

6.400 tables; 55 % of the actas in the first 40 min with bursts ≤ 300/min; 4–11 % resends with
the **same** `Idempotency-Key` (must answer `ALREADY_REGISTERED`); ~180 corrections (version 2);
6–9 % doubtful. `--acelerar 10` = 120 simulated minutes in 12. `--mesas 400` for a quick run.

## 3. Slow client — `lento.ts` (RF-9)

```bash
pnpm fake-events --rate 300 --burst 0          # on a TEST Redis: heavy traffic
pnpm load:lento --url $URL --bps 0 --clientes 50 --duracion 900
```

Prints bytes read and the events received (`snapshot`, `reconnect`) and stops when the server
has cut every slow client. **Expect minutes, not seconds**: the OS buffers several MB per socket
before the server has to buffer anything, and windows keep each connection at ~0,5 KB/s
(~2,5 KB/s with 300 events/s). The policy thresholds themselves are covered by
`apps/server/test/publico.backpressure.test.ts`.

## 4. Avalanche — `avalancha.ts` (RF-10)

```bash
pnpm load:avalancha --url $URL --clientes 10000 --procesos 2 --jitter off --csv avalancha-off.csv
pnpm load:avalancha --url $URL --clientes 10000 --procesos 2 --jitter on  --csv avalancha-on.csv
pnpm load:avalancha --url $URL --clientes 10000 --procesos 2 --jitter on --base-ms 5000 --csv avalancha-on-5s.csv
# when it prints "listo": docker stop preconteo-app3-1   (then docker start it)
```

Counts reconnection attempts in 100 ms buckets (1 s buckets hide a half-second spike).
Local reference (4.000 clients, the only instance restarted):

| Strategy | Peak / 100 ms | Total attempts |
|---|---|---|
| fixed 1 s (like native EventSource) | 1.625 | 20.707 |
| full jitter, base 500 ms (GENERAL §9.4) | 1.024 | 19.389 |
| full jitter, base 5 s (public page) | 163 | 9.069 |

Plot `segundo` vs `reconexiones_100ms` of the three CSVs on the same chart for the report.

## INP under load

Open `/resultados` on a phone while `publico.ts` runs; the page sends INP with `sendBeacon`
and `/ops` shows the p75 (goal ≤ 200 ms).
