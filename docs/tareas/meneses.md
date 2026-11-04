# Meneses — Plataforma, verificación y presencia

> Lee primero `docs/GENERAL.md` (§3, §4, §7.1, §7.4, §8 filas *Bloqueo / Presencia / Límite / Métricas*, §9.3, §9.4 y §13 son tu contrato).
> Eres dueño de **la base sobre la que corren los demás** (monorepo, core, infra, despliegue) y de la audiencia colaborativa: los 120 auditores y el coordinador.

**Requerimientos que cubres:** RF-7, RF-8, RF-10 (detección de Redis caído), RT-1, RT-2, RT-3, RT-7 (recolección), RT-10, autenticación, rate-limit.

## Tus carpetas (solo tú las editas)
```
apps/server/src/main.ts, app.ts
apps/server/src/core/
apps/server/src/modules/verificacion/
apps/server/src/modules/ops/
apps/web/src/app/                      # router, layout, auth, guards
apps/web/src/features/verificacion/
apps/web/src/features/coordinacion/
infra/
supabase/migrations/001_*.sql
CODEOWNERS, .env.example, README.md
```

## Lo que produces para los demás (hazlo primero — desbloquea a todos)
| Para | Qué |
|---|---|
| Todos | Monorepo pnpm + `docker compose up` local (Redis + 2 instancias + nginx) |
| Todos | `core/config` (zod sobre `process.env`), `core/redis` (`redis`, `redisSub`, `crearConexionBloqueante()`, `estadoRedis()`), `core/supabase` |
| Todos | `core/auth`: plugin JWT + `requireRol(...roles)` |
| Todos | `core/rateLimit`: `rateLimit({ clave, limite, ventanaSeg })` → 429 + `Retry-After` |
| Todos | `core/metrics`: `inc`, `observe` (histograma simple p50/p99), `gauge` |
| Evelyn | `core/transport/ClientConnection` (interfaz `send(str)`, `bufferedBytes()`, `close(motivo)`, `onDrain`) con `SseConnection` y `WsConnection` |
| Evelyn | `GET /api/ops/stream` con métricas agregadas |
| Jose | Tabla `usuarios` + login |

## Lo que consumes
- `verif:queue` / `verif:case:{acta}` que llena Jose. **No lo esperes**: `scripts/fake-dudosas.ts` encola casos falsos con el mismo formato.
- `ActasService.aplicarResolucion(...)` de Jose — usa un stub con la misma firma hasta que exista.
- Componentes de `shared/ui` de Evelyn.

---

## Tareas

### 1. Plataforma (Paso 0 y core)
- [ ] Monorepo: `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint + Prettier, scripts `dev`, `build`, `test`, `seed`.
- [ ] `main.ts` / `app.ts`: Fastify con `pino`, header `X-Instance` en toda respuesta, `GET /api/whoami`, `GET /api/health`, registro de módulos (una línea por módulo), apagado ordenado (`SIGTERM`: cerrar SSE con `reconectar`, cerrar WS con código 1012).
- [ ] `core/redis`: ioredis con `enableOfflineQueue: false`, `commandTimeout: 500`, `maxRetriesPerRequest: 1`, reconexión con backoff; `estadoRedis()` = `ok | degradado` (ping cada 1 s; eventos `error`/`ready`). Emite evento interno al cambiar.
- [ ] `core/eventLoop`: `monitorEventLoopDelay({ resolution: 10 })`, reset cada 2 s, p50/p99/max.
- [ ] `core/metrics` + publicación cada 2 s a `metrics:inst:{id}` (`EX 10`) y `ZADD metrics:instances`.
- [ ] `core/auth`: login contra Supabase (`usuarios`, bcrypt), JWT HS256 8 h; usuarios demo de auditor/coordinador/admin en `001_usuarios.sql` o seed.

### 2. Infraestructura y despliegue (RT-1, RT-2, RT-3, RT-10)
- [ ] `Dockerfile` multi-stage del server; build del web copiado a nginx.
- [ ] `infra/docker-compose.yml`: `nginx`, `app1…app8` (anchor YAML para no repetir, `INSTANCE_ID=appN`), `redis` (AOF `everysec`, `maxmemory` + política `noeviction`), `redis-test` para pruebas.
- [ ] `infra/nginx.conf`: `upstream` round-robin **sin** `ip_hash`/`hash`/`sticky`; `location /api/publico/stream` y `/api/ops/stream` con `proxy_buffering off`, `proxy_read_timeout 1h`, HTTP/1.1; `location /ws/` con `Upgrade`/`Connection`; `worker_connections` alto; SPA con `try_files`.
- [ ] VM en la nube con HTTPS y URL pública → seguir [meneses-despliegue.md](meneses-despliegue.md).
- [ ] Demostrar RT-1/RT-2: abrir varias conexiones y mostrar `X-Instance` distintos (botón en `/ops` o `curl` en bucle).

### 3. Verificación (RF-7) — `modules/verificacion`
- [ ] Gateway WS `GET /ws/verificacion` (token JWT en query o primer mensaje; roles `AUDITOR`, `COORDINADOR`). Al conectar: `estado_cola` con la cola completa (`ZRANGE verif:queue 0 -1 WITHSCORES` + `verif:taken` + `verif:case:*`).
- [ ] Suscripción a `ch:verif` (con `redisSub`) y reenvío a los WS locales — así un caso tomado en app3 se ve al instante en app7.
- [ ] Scripts Lua:
  - `tomar.lua`: si `ZSCORE verif:queue acta` existe y `SET lock:acta:{id} <auditor>:<token> NX PX 30000` funciona → `ZREM`, `HSET verif:taken`, `INCR fence:seq`, devolver `{token, fencing}`; si no → `YA_TOMADO`.
  - `renovar.lua`: `if GET lock == token then PEXPIRE 30000`.
  - `liberar.lua` (soltar): `if GET lock == token then DEL lock; HDEL taken; ZADD queue`.
  - `resolver.lua`: verifica token, marca el caso resuelto, borra lock y `taken` — **solo si el token coincide**; después el servicio llama a `aplicarResolucion()` de Jose y guarda en `verificaciones` (Supabase) con el `fencing`.
  - `reaper.lua`: para cada acta en `verif:taken` sin `lock` → devolver a la cola; devuelve las liberadas para publicar `caso_liberado`.
- [ ] Latido del cliente cada 10 s con `actividad` (última interacción). El servidor renueva solo si `ahora − actividad < 5 min` (resuelve la tensión expirar vs. seguir trabajando; GENERAL §9.3).
- [ ] Reaper cada 5 s en todas las instancias (es idempotente).
- [ ] `GET /api/verificacion/:acta/foto` → URL firmada de Supabase Storage (60 s).
- [ ] Rechazo: el caso queda `RECHAZADA` en `acta:{id}` (vía Jose) y el jurado lo ve en su polling.

### 4. Presencia y coordinación (RF-8)
- [ ] En cada latido: `SET presence:{sub} {nombre, instancia, caso, desde, activo} EX 30` + `ZADD presence:idx <ahora> sub` + `PUBLISH ch:presence`.
- [ ] Lista: `ZRANGEBYSCORE presence:idx (ahora−30000) +inf` → `MGET presence:*`; `ZREMRANGEBYSCORE` para podar fantasmas. Al cerrar el WS limpiamente, borrar de inmediato.
- [ ] El coordinador recibe `presencia` por WS al cambiar y cada 5 s.

### 5. Pantallas
- [ ] `/login` y guards por rol (`app/`), redirección según rol, logout.
- [ ] `/verificacion`: tabla en vivo (prioridad, acta, municipio/puesto, motivo, tiempo en cola), filas tomadas por otros en gris con nombre y candado, botón *Tomar*; reconexión WS con `backoff.ts` y recarga de `estado_cola`.
- [ ] `/verificacion/:acta`: foto con zoom, valores digitados vs regla contable (descuadre en rojo), acciones *Aprobar* / *Aprobar con corrección* (formulario editable) / *Rechazar* (motivo); barra del lock (renovando / "se liberará por inactividad en 1:00").
- [ ] `/coordinacion`: tarjetas por auditor (instancia, caso actual, cuánto lleva, activo/inactivo), contadores de cola.

### 6. Operación (RT-7) — `modules/ops`
- [ ] `GET /api/ops/stream` (ADMIN): cada 2 s lee `metrics:instances` + `metrics:inst:*` y emite el agregado por SSE. La UI la hace Evelyn.

## Guía de despliegue (RT-1, RT-10)

Eres el responsable del despliegue (backend, frontend y Redis; Supabase lo crea Jose). La guía completa, con los archivos del esqueleto listos para copiar, está en **[meneses-despliegue.md](meneses-despliegue.md)**. Despliega el esqueleto desde el primer día y vuelve a desplegar cada vez que algo entre a `main`.

## Pruebas necesarias (vitest + Redis real)
1. **Exclusividad**: 20 `tomar` concurrentes del mismo caso → exactamente 1 éxito.
2. **Liberación segura**: A toma, su lock expira, B toma; A intenta `resolver`/`soltar` con su token → rechazado, el lock de B sigue.
3. **Reaper**: lock expirado → el caso vuelve a `verif:queue`.
4. **Presencia**: sin latido → el auditor sale de la lista en ≤ 30 s.
5. **Redis caído** (con Jose): `docker stop redis` → `/api/health` 503, `whoami` dice `degradado`, ingesta 503.

## Definición de terminado
- Dos auditores en navegadores distintos (instancias distintas) ven en vivo cuando el otro toma un caso; cerrar uno devuelve el caso solo.
- La URL pública abre y reparte entre 8 instancias sin afinidad.
- Sección del informe: RF-7 (lease, renovación por actividad, fencing), RF-8, RT-2 (qué evita y qué crea no tener sesiones pegajosas), diseño de canales, Redis caído.
