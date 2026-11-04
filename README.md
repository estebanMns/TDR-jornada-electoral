# Mesa a Mesa — preconteo electoral en tiempo real

Sistema de preconteo para una jornada electoral departamental (6.400 mesas, 1.842 puestos, 30 municipios). Los jurados transmiten el acta E-14 de su mesa, el sistema la suma **una sola vez** en mesa, puesto, municipio y departamento, las actas que no cuadran pasan a **verificación humana**, y el público ve el avance **en vivo**. Corre en **8 instancias detrás de un balanceador sin afinidad**, coordinadas solo por **Redis**.

Proyecto de Programación orientada a la web (Ingeniería de Software, 7.º semestre) — Jose, Evelyn y Meneses.

## Probarlo en línea

**URL:** https://tdr-jornada-electoral.vercel.app (redirige al servidor en AWS: https://3-130-180-203.sslip.io)

> **Si la página dice «Encendiendo el servidor…», espera 1–2 minutos.** Para ahorrar crédito, el servidor se apaga solo tras 30 minutos sin visitas y la primera visita lo vuelve a encender (entra sola cuando está listo). Los datos se conservan.

### Usuarios de prueba

| Rol | Usuario | Contraseña | Qué puede hacer |
|---|---|---|---|
| Público | — (sin login) | — | Ver resultados en vivo en `/resultados` |
| Jurado | `jurado0001` … `jurado6400` (uno por mesa) | `9ff4bd66bd77` | Transmitir el acta de **su** mesa y ver su estado |
| Auditor | `auditor001` … `auditor120` | `auditor-demo` | Tomar y resolver actas dudosas |
| Coordinador | `coordinador` | `coord-demo` | Lo del auditor + ver quién está conectado |
| Operación | `admin` | `admin-demo` | Tablero técnico de las 8 instancias (`/ops`) |

Son cuentas de demostración de un entorno de pruebas.

### Recorrido sugerido (10 minutos)

1. **Portada** (`/`): explica el sistema y muestra el **mapa de mesas** del departamento, que se va llenando a medida que informan.
2. **Resultados** (`/resultados`): elige un municipio y un puesto. Deja la pestaña abierta: se actualiza sola cada 2 s, sin recargar.
3. **Jurado**: en otra ventana entra con `jurado0001`. Llena el acta (los votos deben sumar los sufragantes), adjunta una foto y transmítela. En *Envíos* aparece **Registrada** y en la pestaña de resultados la mesa se suma en segundos.
   - **Sin red:** activa el modo avión (o *Offline* en las herramientas del navegador) y transmite: el acta queda en cola y se envía sola al volver la conexión.
   - **Acta que no cuadra:** pon más sufragantes que votos. Queda **En verificación** y no suma.
4. **Auditor**: en otro navegador entra con `auditor001` y en otro con `auditor002`. Cuando uno toma el acta, el otro la ve bloqueada al instante. Apruébala o corrígela y mira cómo cambia el resultado. Si un número baja, la página pública explica por qué.
5. **Coordinador** (`coordinador`): ve a cada auditor, en qué instancia está conectado y qué caso revisa.
6. **Operación** (`admin`): `/ops` muestra conexiones por instancia, mensajes por segundo, retraso del Event Loop, latencia, mensajes reales frente a la cifra ingenua e INP.
7. **Ocho instancias sin afinidad**: cada respuesta trae el header `X-Instance`. Desde una terminal:
   ```bash
   for i in $(seq 1 16); do curl -s https://3-130-180-203.sslip.io/api/whoami; echo; done
   ```

## Instalación local

Requisitos: **Node 22+**, **pnpm 10+**, **Docker** y un proyecto de **Supabase** (gratis).

```bash
git clone https://github.com/estebanMns/TDR-jornada-electoral.git
cd TDR-jornada-electoral
pnpm install
cp .env.example .env
```

En `.env` llena como mínimo:

| Variable | Valor |
|---|---|
| `JWT_SECRET` | cadena aleatoria de 32+ caracteres (`openssl rand -hex 32`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | *Project Settings → API* de Supabase (clave `service_role`) |
| `REDIS_URL` | `redis://localhost:6379` |
| `SEED_JUROR_PASSWORD` | contraseña de prueba para los jurados |

En Supabase, aplica las migraciones de `supabase/migrations/` en orden (SQL Editor o `supabase db push`). Luego:

```bash
docker compose -f infra/docker-compose.local.yml up -d redis redis-test   # Redis :6379 y Redis de pruebas :6380
pnpm seed          # catálogo (Redis + Supabase) y jurado0001…jurado6400
pnpm dev           # plataforma (portada, resultados, verificación, ops)  → http://localhost:3000
pnpm dev:actas     # servicio de actas                                    → :3001
pnpm dev:jurado    # app del jurado                                       → http://localhost:5173/jurado/
pnpm test          # pruebas contra Redis real
```

Todo junto con nginx y varias instancias, como en producción: `docker compose -f infra/docker-compose.local.yml up --build` → http://localhost:8080.

Despliegue en la nube: [`docs/despliegue-aws.md`](docs/despliegue-aws.md) (la infraestructura de AWS está en `infra/aws/preconteo-ec2.yaml`). Pruebas de carga: [`loadtest/README.md`](loadtest/README.md).

## Pantallas

| Ruta | Quién | Qué hace |
|---|---|---|
| `/` | todos | Bienvenida: cómo funciona y avance en vivo del departamento |
| `/resultados` | público | Resultados por departamento, municipio y puesto; mapa de mesas; avisos de corrección |
| `/login` | equipo | Ingreso; cada rol va a su pantalla |
| `/jurado/` | jurado | PWA: formulario del acta, foto, cola sin conexión, historial de envíos |
| `/verificacion` | auditor, coordinador | Cola en vivo de actas dudosas: tomar, aprobar, corregir, rechazar |
| `/coordinacion` | coordinador | Presencia y reparto del trabajo |
| `/ops` | admin | Métricas de operación (RT-7) |

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
infra/                              # Dockerfiles (app, actas, nginx), compose (prod y local), nginx, redis, deploy
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

## Parte de Jose: actas (RF-1, RF-2, RF-3, RT-6)

La ingesta corre como **servicio aparte** (TypeScript + Fastify) junto a la plataforma; nginx enruta `/api/actas` a `actas1…actas8` y sirve la PWA del jurado en `/jurado/`. Los dos lados se hablan solo por Redis y por el puerto `actasService` (ver *Integración*).

```
apps/server/                        # servicio de actas (@preconteo/server, puerto ACTAS_PORT=3001)
  src/modules/actas/
    lua/apply_acta.lua              # operación atómica: idempotencia → versión → 4 niveles → eventos
    actas.service.ts  .routes.ts    # POST /api/actas, PUT …/photo, GET /api/actas/mine, POST /api/actas/resolutions
    persistence.worker.ts           # consumer group `persist` sobre ev:actas → Supabase
  test/                             # garantías RF-1/2/3/10 + contrato con casoVerificacionSchema
apps/jurado/                        # PWA del jurado (Vite + React): outbox en IndexedDB, base /jurado/
apps/web/src/server/modules/actas/  # moduloActas: registra actasService → POST /api/actas/resolutions
packages/contracts/                 # contratos TS de actas + catalog.json (generado por el seed)
scripts/                            # seed.ts (catálogo + jurados), fake-acta.ts, dev-token.ts
supabase/migrations/010_catalog_and_actas.sql
```

```bash
pnpm seed                         # catálogo en Redis y Supabase + jurado0001…jurado6400
pnpm dev:actas                    # servicio de actas en :3001 (junto a `pnpm dev` en :3000)
pnpm dev:jurado                   # PWA en http://localhost:5173/jurado/ (proxy igual que nginx)
pnpm fake-acta --table 42         # acta de prueba (--kind doubtful | correction, --repeat 5)
```

Detalle del módulo: [`apps/server/src/modules/actas/README.md`](apps/server/src/modules/actas/README.md).

## Integración con los demás

- **Jose**: `moduloActas` registra `actasService` (`RemoteActasService`): traduce la decisión (`APROBAR` → `APPROVE`…) y la envía a `ACTAS_URL/api/actas/resolutions`, donde la aplica el mismo Lua. Si el servicio de actas no responde, lanza error y la verificación compensa y reencola el caso. Las actas dudosas llegan a `verif:case:{acta}` con `casoVerificacionSchema` y se anuncian con `caso_nuevo`; una resolución con `fencing` no mayor al último aplicado se rechaza (`STALE_FENCING`).
- **Evelyn**: `moduloPublico` (`apps/web/src/server/modules/publico/`) lee `ev:all` —los eventos que escribe `apply_acta.lua`— con `XREAD BLOCK`, agrupa por tópico en ventanas de 2 s y envía por SSE en lotes de 500 cediendo el Event Loop. Ver *Parte de Evelyn* abajo.

## Parte de Evelyn: difusión pública (RF-4, RF-5, RF-6, RF-9)

```
apps/web/src/server/modules/publico/
  eventos.js                 # lectura de ev:all (abs por tópico, valores absolutos)
  publico.service.js         # lector XREAD, ventanas de 2 s, fan-out por lotes, continuidad, degradado
  topic-registry.js          # Map<tópico, Set<conexión>>: alta O(1), recorrido O(suscriptores)
  backpressure-policy.js     # > 64 KB deja de enviar detalle; drain → fotografía; > 512 KB o 30 s → reconectar
  publico.repository.js      # XRANGE para reconexión, fotografía atómica (lua/snapshot.lua), INP
apps/web/src/features/publico/  # /resultados: cliente SSE con jitter, render agrupado por cuadro, mapa de mesas
apps/web/src/features/inicio/   # portada con el avance en vivo
apps/web/src/features/ops/      # /ops: tablero RT-7
apps/web/test/publico/          # continuidad, fotografía, un mensaje por ventana, Event Loop con 50.000 conexiones, cliente lento
loadtest/                       # publico.mjs (20.000+ conexiones, avalancha con/sin jitter), jornada.ts, lento.mjs
```

- **Rutas:** `GET /api/publico/stream?topics=dep,mun:11` (SSE; `Last-Event-ID` o `?lastEventId=`), `GET /api/publico/snapshot?topic=…`, `POST /api/vitals` (INP).
- **Reconexión (RF-6):** el id de cada mensaje es el id del stream `ev:all`. Al volver, el cliente recibe un único delta con lo que se perdió; si su id ya salió del historial, si faltan más de 2.000 eventos o pasaron más de 10 min, recibe la fotografía completa.
- **Medido en las pruebas:** con 50.000 conexiones el Event Loop se bloquea **574 ms sin lotes y ~17 ms con lotes de 500**; 30 actas en la misma ventana producen **1** mensaje por suscriptor.
- **Límite de aperturas** del stream por IP: `PUBLICO_LIMITE_POR_MIN` (30 por defecto; subirlo durante la prueba de carga).

## Despliegue

Ver [`docs/despliegue-aws.md`](docs/despliegue-aws.md) y [`infra/deploy.md`](infra/deploy.md).
