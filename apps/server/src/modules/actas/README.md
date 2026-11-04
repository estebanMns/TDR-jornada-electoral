# actas — ingestion module (owner: Jose)

Receives the acta of each table exactly once, keeps the four levels of totals
consistent and tells the juror, unambiguously, what happened (RF-1, RF-2, RF-3).

Runs as its own Fastify service (`apps/server`, `ACTAS_PORT`, default 3001) next
to the platform server (`apps/web`); nginx routes `/api/actas` here. It accepts
the tokens issued by the platform login (`rol`/`nombre`/`mesa` claims, header or
`preconteo_sesion` cookie).

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
| `POST /api/actas/resolutions` | AUDITOR, COORDINATOR | `ResolutionReceipt`: `RESOLVED` / `OBSOLETE` / `NOT_UNDER_REVIEW` / `STALE_FENCING` |

## For the other modules

- **Public (Evelyn)** — one `ev:all` entry per real change: `acta, version, type
  (APPLIED | CORRECTION | REVERSAL), reason, tsRx, table, station, mun, abs`.
  `abs` holds the new **absolute** values of only the fields that changed per
  topic (`dep`, `mun:{id}`, `station:{id}`); `_reported` = tables reporting.
  Totals live in `tot:*` hashes, rankings in `rank:*` sorted sets, table counts
  in `cat:n:*`. `parseAccumulatedEvent` in `@preconteo/contracts` parses entries.
- **Verification (Meneses)** — doubtful/conflicting actas follow his contract
  (`casoVerificacionSchema` in `packages/shared`, checked by a test): JSON string
  in `verif:case:{acta}` (`motivo` DESCUADRE | SUFRAGANTES_EXCEDEN | CONFLICTO,
  `prioridad` 1-3, `puesto`/`municipio` with names; conflicts add
  `votosEnConflicto`) and `verif:queue` scored with `scoreDeCaso`. `ch:verif`
  gets `caso_nuevo { item }`, and `caso_resuelto` when a newer version
  supersedes the case. Once enqueued, the case belongs to the verification
  module. Its `actasService` (`apps/web/src/server/modules/actas`) forwards each
  decision to `POST /api/actas/resolutions`; a fencing token not newer than the
  last applied one is rejected (`STALE_FENCING`). The worker only updates the
  status in `acta_versions`; the decision itself goes to `verificaciones`.

## Running

```bash
docker run -d --name electoral-redis-test -p 6380:6379 redis:7-alpine
pnpm --filter @preconteo/server test
pnpm seed --no-supabase && pnpm dev:actas
pnpm fake-acta --table 42 --repeat 3
```
