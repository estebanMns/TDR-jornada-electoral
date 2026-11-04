# actas — ingestion module (owner: Jose)

Receives the acta of each table exactly once, keeps the four levels of totals
consistent and tells the juror, unambiguously, what happened (RF-1, RF-2, RF-3).

```
actas.routes.ts       HTTP: validation (zod), auth, mapping to the service
actas.service.ts      use cases: submit, applyResolution, listJurorActas, storePhoto
actas.repository.ts   the only file that knows Redis keys / commands
actas.rules.ts        doubt rules, review priority, content hash
lua/apply_acta.lua    the atomic operation (idempotency → version → totals → events)
history.store.ts      Supabase history (acta_versions)
persistence.worker.ts consumer group `persist` on ev:actas
photo.storage.ts      Supabase Storage / local directory
```

## HTTP

| Route | Role | Answer |
|---|---|---|
| `POST /api/actas` + `Idempotency-Key` | JUROR | `ActaReceipt`: 201 `REGISTERED`; 200 `ALREADY_REGISTERED` / `OBSOLETE` / `UNDER_REVIEW` / `CONFLICT`; **503 `NOT_REGISTERED`** + `Retry-After` when Redis is down |
| `PUT /api/actas/:actaId/v/:version/photo` (body `image/jpeg`) | JUROR | 204; 422 if the SHA-256 differs from `photoHash` |
| `GET /api/actas/mine` | JUROR | `{ actas: JurorActaState[] }`, `ETag` → 304 |

## For the other modules

- **Public (Evelyn)** — one `ev:all` entry per real change: `acta, version, type
  (APPLIED | CORRECTION | REVERSAL), reason, tsRx, table, station, mun, abs`.
  `abs` holds the new **absolute** values of only the fields that changed per
  topic (`dep`, `mun:{id}`, `station:{id}`); `_reported` = tables reporting.
  Totals live in `tot:*` hashes, rankings in `rank:*` sorted sets, table counts
  in `cat:n:*`. `parseAccumulatedEvent` in `@preconteo/contracts` parses entries.
- **Verification (Meneses)** — doubtful/conflicting actas are added to
  `verif:queue` (score = priority, lower first) and `verif:case:{acta}` (hash:
  `version, reason, votes, voters, enabled, photoHash, status=PENDING…`; conflicts
  also carry `conflictingVotes`). `PUBLISH ch:verif` sends `case_new` and
  `case_superseded` (a newer version arrived: the case is obsolete).
  Resolve with `app.actasService.applyResolution({ actaId, version, decision,
  votes?, voters?, auditor, fencing, reason? })` → `RESOLVED | OBSOLETE |
  NOT_UNDER_REVIEW`. The worker only updates the status in `acta_versions`; the
  decision itself goes to `verificaciones` (verification module, migration 001).

## Running

```bash
docker run -d --name electoral-redis-test -p 6380:6379 redis:7-alpine
pnpm --filter @preconteo/server test
pnpm seed --no-supabase && pnpm dev:server
pnpm fake-acta --table 42 --repeat 3
```
