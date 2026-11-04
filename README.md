# Preconteo electoral en tiempo real

Monorepo del equipo (Jose, Evelyn, Meneses). Documento base: `docs/GENERAL.md`.
Esta entrega cubre **la parte de Meneses**: plataforma (core, infraestructura, despliegue), verificación colaborativa (RF-7), presencia (RF-8), detección de Redis caído (RF-10), recolección de métricas (RT-7), autenticación y límite de tasa.

## Stack (adaptación a Next.js + JavaScript)

El GENERAL proponía Fastify + Vite + TypeScript. El equipo decidió **Next.js 16 (App Router) con JavaScript**, así que la arquitectura se adaptó sin cambiar los contratos:

| GENERAL | Aquí | Por qué |
|---|---|---|
| `apps/server` (Fastify) + `apps/web` (Vite) | **una sola app Next** `apps/web` con **servidor propio** (`server.js`) | Next no maneja `upgrade` de WebSocket y sus Route Handlers no exponen `writableLength`/`drain` (necesarios para la contrapresión RF-9). El servidor propio atiende SSE y WS directamente y delega el resto a Next. |
| `main.ts` / `app.ts` | `src/server/main.js` / `src/server/app.js` | Igual: arranque y registro de módulos (una línea por módulo). |
| plugins Fastify | objetos `Modulo { nombre, registrar(plataforma) }` | Misma idea: cada dueño registra su módulo. |
| `requireRol` de Fastify | guardias encadenables (`ManejadorHttp.ruta([guardias], manejador)`) | Chain of Responsibility; las rutas Next son adaptadores de una línea. |
| middleware de guards | `src/proxy.js` (Next 16 renombró `middleware` → `proxy`) | Redirección por rol en las páginas. |
| TypeScript | JavaScript ESM + JSDoc + **zod** en los bordes | Validación en tiempo de ejecución donde entra información. |

### Detalle importante: dos grafos de módulos

Next empaqueta las rutas aparte, así que un singleton importado en una ruta sería **otra instancia**. Por eso el servidor publica un `Contenedor` en `globalThis` (`src/server/contenedorGlobal.js`) y las rutas solo hacen:

```js
export const POST = accion('auth', 'login');
```

Por la misma razón los errores no se comparan con `instanceof` sino con una marca `Symbol.for(...)`.

## Estructura (lo de Meneses)

```
apps/web/
  server.js                         # entrada de cada instancia (app1…app8)
  src/server/
    main.js, app.js                 # arranque + composición (1 línea por módulo)
    contenedorGlobal.js             # puente servidor ↔ rutas Next
    core/
      Plataforma.js                 # raíz de composición del núcleo
      config/  logger.js            # zod sobre process.env, pino con instancia
      redis/                        # RedisGateway (ok|degradado), PubSub, CanalRedis, carga de Lua
      supabase/                     # cliente service_role con tiempo máximo
      auth/                         # TokenService (JWT HS256 8 h), AuthService, requireRol, login
      rateLimit/                    # RateLimiter.rateLimit({ clave, limite, ventanaSeg }) → 429
      metrics/  eventLoop/          # inc/observe/gauge, publicación cada 2 s, p50/p99/max del loop
      transport/                    # ClientConnection (Adapter) + SseConnection + WsConnection
      realtime/                     # RealtimeRouter: SSE y WS fuera de Next
      http/  tasks/  lifecycle/     # ManejadorHttp, TareaPeriodica, ApagadoOrdenado
    modules/
      verificacion/                 # RF-7 + RF-8
        lua/                        # tomar, renovar, liberar, resolver, reaper
        verificacion.repository.js  # único lugar que conoce las claves verif:*
        verificacion.service.js     # casos de uso (lease, fencing, compensación)
        presencia.*.js              # latido + TTL, solo publica si algo visible cambia
        ws/                         # Gateway WS, Comandos (Command), NotificadorPresencia
        actas.puerto.js             # puerto hacia Jose + stub con la misma firma
      ops/                          # GET /api/ops/stream (ADMIN)
  src/proxy.js                      # guards por rol de las páginas
  src/app/
    login/  (consola)/verificacion  (consola)/coordinacion  api/…
  src/features/verificacion/        # ClienteVerificacion (WS + backoff + latido), reducer, UI
  src/features/coordinacion/        # panel de presencia
  test/                             # vitest contra Redis real
  scripts/                          # fake-dudosas.js, smoke-dos-instancias.js
packages/shared/                    # contratos (redisKeys, roles, schemas zod, regla contable)
infra/                              # Dockerfile, compose (prod y local), nginx, redis, deploy
supabase/migrations/001_plataforma.sql
```

## Cómo correrlo

Requisitos: Node 22+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env              # llenar JWT_SECRET, SUPABASE_*, REDIS_*

# Opción A — todo en Docker: Redis + 2 instancias + nginx → http://localhost:8080
docker compose -f infra/docker-compose.local.yml up --build

# Opción B — desarrollo con recarga: solo Redis en Docker y Next en tu máquina
docker compose -f infra/docker-compose.local.yml up -d redis redis-test
# en .env: REDIS_URL=redis://localhost:6379 y REDIS_PASSWORD vacío
pnpm dev                          # http://localhost:3000  (usa server.js, NO `next dev`)

pnpm fake:dudosas 30              # casos de verificación falsos (sin esperar a Jose)
```

Usuarios demo (migración `001`): `admin/admin-demo`, `coordinador/coord-demo`, `auditor001…auditor120/auditor-demo`.

## Pruebas

```bash
docker compose -f infra/docker-compose.local.yml up -d redis-test   # Redis en :6380
pnpm test
```

| Garantía | Prueba |
|---|---|
| RF-7 exclusividad | 20 `tomar` concurrentes → exactamente 1 éxito |
| RF-7 liberación segura | A expira, B toma; el token de A no resuelve ni suelta; el lock de B sigue |
| RF-7 reaper | lock expirado → vuelve a `verif:queue` con su prioridad; idempotente |
| RF-7 renovación por actividad | latido activo renueva; inactivo > 5 min no renueva y expira |
| RF-7 compensación | si `aplicarResolucion` falla, el caso vuelve tal cual a la cola |
| RF-8 presencia | sin latido sale de la lista en ≤ TTL; salir borra de inmediato |
| RF-10 Redis caído | `/api/health` 503, `whoami` = `degradado`, operaciones fallan en < 50 ms |
| Auth | 401 / 403 / 503 si Supabase no responde |

**Humo de punta a punta** (con dos instancias levantadas): `pnpm smoke` comprueba que dos auditores en instancias distintas se ven en vivo, que el jurado es rechazado antes del upgrade, la presencia del coordinador y que un cierre abrupto devuelve el caso solo.

## Contratos que se proponen para `packages/shared` (PR de los tres)

Todos son **aditivos**:

- `casoVerificacionSchema` y `scoreDeCaso()`: formato de `verif:case:{acta}` y score de `verif:queue` (prioridad, luego orden de llegada). **Jose debe encolar con este formato** y publicar `{ tipo: 'caso_nuevo', item }` en `ch:verif` (ver `dev/casosFalsos.js`).
- Mensajes WS nuevos: `lock_renovado { acta, expiraEn }` y `estado { redis }` (para deshabilitar acciones si Redis cae).
- `latido` acepta `inactivoMs` (relativo, inmune al desfase de reloj del navegador) además de `actividad`.
- `resolver` acepta `sufragantes` opcional (para corregir un caso `SUFRAGANTES_EXCEDEN`).
- `aplicarResolucion` recibe también `motivo` y `sufragantes`. Jose debe **rechazar resoluciones con `fencing` menor** al último aplicado para esa acta.

## Integración con los demás

- **Jose**: registra su servicio con `contenedor.registrar('actasService', servicio)`; el puerto perezoso lo usa automáticamente en lugar del stub. Para el estado de Redis en la ingesta: `plataforma.redis.disponible()` / `redis.ejecutar(...)` lanzan `RedisNoDisponibleError` → 503 `NO_REGISTRADA`.
- **Evelyn**: `router.http('/api/publico/stream', …)` con `SseConnection` (tiene `bufferedBytes()`, `onDrain`, `close(motivo)`); `redis.crearConexionBloqueante()` para `XREAD BLOCK`; `metrics.inc/observe/gauge`. El tablero `/ops` consume `GET /api/ops/stream` (eventos `metricas` y `estado`).

## Despliegue

Ver [`infra/deploy.md`](infra/deploy.md).
