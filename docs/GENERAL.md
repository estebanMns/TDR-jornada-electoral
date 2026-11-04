# Preconteo electoral en tiempo real — Documento general

> Documento base del equipo (Jose, Evelyn, Meneses). Define **qué** se construye, **cómo** se organiza y **los contratos** que permiten trabajar en paralelo sin pisarse. Las tareas de cada persona están en `docs/tareas/`.
>
> Fuente: *Caso de estudio — Transmisión y difusión de resultados en una jornada electoral* (RF-1…RF-10, RT-1…RT-10).
>
> ⚠️ El PDF menciona una **sección 7 (qué medir)** que no aparece en el documento recibido (termina en la página 6). Aquí se proponen las mediciones (ver §11); confirmen con el profesor si hay una lista oficial.

---

## 1. Resumen del sistema

Un acta entra (jurado) → se aplica de forma **atómica e idempotente** en Redis → llega con garantías distintas a tres audiencias repartidas sobre **8 instancias sin sesiones pegajosas** que solo se coordinan a través de **Redis**.

| Audiencia | Rol(es) | Transporte | Por qué (resumen; se defiende con mediciones §11) |
|---|---|---|---|
| Jurados (6.400, red móvil mala) | `JURADO` | **HTTP POST idempotente + polling con ETag** | Cada envío es una petición independiente que sobrevive a cortes; la respuesta HTTP *es* la confirmación. Un socket persistente en red intermitente vive reconectando. El estado (correcciones/rechazos) cambia poco → polling cada 15 s con `304 Not Modified` cuesta casi nada. |
| Auditores (120, toda la jornada) | `AUDITOR`, `COORDINADOR` | **WebSocket** | Bidireccional y colaborativo: tomar/soltar casos, latidos, ver a los demás en vivo. Pocas conexiones, larga duración. |
| Público (hasta 400.000) | anónimo | **Server-Sent Events (SSE)** | Unidireccional, HTTP plano (pasa proxies/balanceador), reconexión nativa con `Last-Event-ID` (base de RF-6), menor costo por conexión que WS y sin parser de frames del lado del cliente. |

Coexisten **tres** transportes (RT-5 exige al menos dos).

---

## 2. Stack y decisiones técnicas

| Capa | Elección |
|---|---|
| Lenguaje | **TypeScript** en todo el monorepo (Node 22 LTS o superior) |
| Monorepo | **pnpm workspaces**: `apps/server`, `apps/web`, `packages/shared`, `loadtest` |
| Backend | **Fastify 5** + `@fastify/websocket` (ws) + SSE manual sobre `reply.raw`, `@fastify/jwt`, `zod`, `pino` |
| Redis | **Redis 7** (una instancia, AOF `everysec`) con **ioredis**; scripts **Lua** cargados con `defineCommand` |
| Persistencia durable | **Supabase**: Postgres (usuarios, catálogo, histórico de actas y verificaciones) + Storage (fotos de actas) |
| Frontend | **React + Vite + React Router**, **Tailwind CSS + shadcn/ui**, `vite-plugin-pwa` (jurado offline), `idb-keyval` (IndexedDB), `web-vitals` (INP), `uPlot` o `recharts` solo en el tablero de operación |
| Balanceador | **Nginx** round-robin **sin** `ip_hash`/afinidad, `proxy_buffering off` para SSE, upgrade para WS |
| Despliegue | **Docker Compose** en una VM en la nube: `nginx` + `app1…app8` + `redis` (+ web estática servida por nginx). Recomendado: VM 4 vCPU / 8 GB (Azure for Students, DigitalOcean o GCP). Supabase en su nube (plan gratuito). |
| Despliegue | **Docker Compose** en una VM en la nube: `nginx` + `app1…app8` + `redis` (+ web estática servida por nginx). **AWS EC2** (`t3.medium` en desarrollo, `m6i.xlarge` para carga y sustentación, región `us-east-1`). Supabase en su nube (plan gratuito). |
| Pruebas | `vitest` contra un Redis real (servicio `redis-test` del compose). Solo las pruebas que demuestran garantías (ver cada MD). |
| Carga | Scripts Node propios en `loadtest/` (clientes SSE crudos sobre `http`, simulador de jurados, cliente lento, avalancha) |

### Por qué Redis + Supabase
- **Redis** es el camino caliente: acumulados, idempotencia, streams, locks, presencia, rate-limit, backplane. Todo lo que tiene que ser rápido y compartido entre instancias.
- **Supabase** es el registro durable y lo que no tiene sentido en memoria: usuarios, catálogo, cada versión de acta con su foto, decisiones de auditoría. **No está en el camino crítico**: si Supabase cae, el preconteo sigue (las actas se persisten después desde un stream con consumer group).

---

## 3. Arquitectura

```
                         Internet
                            │
                     ┌──────▼──────┐
                     │   Nginx LB  │  round-robin, sin afinidad
                     │ + web build │  (sirve el SPA estático)
                     └──┬───┬───┬──┘
          HTTP/SSE/WS   │   │   │   ...
     ┌──────────┬───────┴┐ ┌┴───────┐ ┌──────────┐
     │  app1    │  app2  │ │  ...   │ │  app8    │   misma imagen, INSTANCE_ID distinto
     │ Fastify  │        │ │        │ │          │   (no se hablan entre sí — RT-3)
     └────┬─────┴───┬────┘ └───┬────┘ └────┬─────┘
          │         │          │           │
          └─────────┴────┬─────┴───────────┘
                         │  ioredis (comandos, Lua, XREAD, Pub/Sub)
                   ┌─────▼─────┐               ┌─────────────────────┐
                   │  Redis 7  │               │ Supabase            │
                   │  (AOF)    │               │ Postgres + Storage  │
                   └───────────┘               └─────────▲───────────┘
                                                         │ worker de persistencia
                                                         │ (XREADGROUP sobre ev:actas)
```

### 3.1 Estilo de código: monolito modular con capas
Cada instancia corre **la misma aplicación**, organizada por **módulos de negocio** (cada uno con un dueño). Dentro de cada módulo:

```
modules/<modulo>/
  <modulo>.routes.ts      # HTTP/SSE/WS: validación (zod), auth, mapeo a servicio. Sin lógica.
  <modulo>.service.ts     # Casos de uso / reglas de negocio
  <modulo>.repository.ts  # Acceso a Redis/Supabase (único lugar que conoce claves)
  lua/*.lua               # Scripts atómicos del módulo
  index.ts                # plugin Fastify que registra todo
```

### 3.2 Patrones que se usan (y dónde)

| Patrón | Dónde | Para qué |
|---|---|---|
| **Repository** | `*.repository.ts` | Aislar Redis/Supabase de la lógica; facilita pruebas |
| **Plugin / Módulo** (Fastify) | `modules/*/index.ts` | Cada persona registra su módulo con una línea en `app.ts` |
| **Adapter** | `core/transport/ClientConnection` con `SseConnection` y `WsConnection` | El fan-out no sabe qué transporte hay debajo; mide `bufferedBytes()` igual en ambos |
| **Observer / Pub-Sub** | Backplane Redis, `TopicRegistry` | Desacopla quién produce de quién consume |
| **Outbox** (cliente) | App del jurado (IndexedDB) | Encolar actas offline y reenviar sin intervención (RT-6) |
| **Idempotency Key** | Ingesta de actas | Reenvío = misma respuesta, una sola suma (RF-1) |
| **Lease + Fencing token** | Locks de verificación | Asignación exclusiva, renovación y liberación segura (RF-7) |
| **Strategy** | `BackpressurePolicy` | Política de clientes lentos intercambiable (RF-9) |
| **Exponential backoff + full jitter** | Clientes SSE, WS y outbox | Evita la avalancha de reconexión (RF-10) |
| **Circuit breaker simple / modo degradado** | `core/redis` | Fallar rápido y explícito si Redis no responde (RF-10) |

### 3.3 Sin sesiones pegajosas (RT-2)
- **Evita**: desbalance de carga, instancias "calientes", pérdida de todo el estado de un usuario cuando cae *su* instancia.
- **Crea**: cada petición/reconexión puede caer en otra instancia → **nada de estado de usuario en memoria de la instancia**. Por eso: JWT sin estado, historial de eventos en Redis Streams (RF-6), locks y presencia en Redis (RF-7/8), idempotencia en Redis (RF-1). Lo único en memoria son las conexiones abiertas en esa instancia y su índice por tópico.
- Cada respuesta lleva el header `X-Instance: appN` y existe `GET /api/whoami` (RT-1).

---

## 4. Roles y permisos

| Rol | Cómo entra | Puede |
|---|---|---|
| `PUBLICO` | Sin login | Ver resultados en vivo por departamento / municipio / puesto |
| `JURADO` | Login (usuario por mesa) | Transmitir el acta de **su** mesa (JWT trae `mesa`), corregirla (nueva versión), ver estado de sus envíos |
| `AUDITOR` | Login | Ver cola de verificación en vivo, tomar un caso, aprobar / aprobar con corrección / rechazar |
| `COORDINADOR` | Login | Todo lo del auditor + panel de presencia y reparto del trabajo |
| `ADMIN` | Login | Tablero de operación (métricas por instancia, pruebas de carga) |

JWT (HS256, 8 h) con `sub`, `rol`, `nombre`, `mesa?`. Usuarios en Supabase (`usuarios`, contraseña con bcrypt). El login es la única llamada a Supabase en un flujo de usuario; el resto valida el JWT localmente.

---

## 5. Pantallas

Un solo SPA (React) con rutas **cargadas de forma perezosa** (`React.lazy`) para que la página pública sea liviana (RT-9). Estilo: Tailwind + shadcn/ui, tipografía Inter, modo claro/oscuro, componentes compartidos en `apps/web/src/shared/ui`.

| Ruta | Rol | Contenido | Dueño |
|---|---|---|---|
| `/` | público | Redirige a `/resultados` | Evelyn |
| `/resultados` y `/resultados/:nivel/:id` | público | Selector municipio → puesto; ranking de candidatos con barras; votos, %; **% mesas informadas**; hora del último dato; indicador *En vivo / Reconectando / Pausado*; aviso visible cuando un número baja ("Corrección del acta E14-…") | Evelyn |
| `/login` | todos | Usuario/contraseña; redirige según rol | Meneses |
| `/jurado` | JURADO | Formulario del acta de su mesa: foto (cámara), votos por candidato, blanco, nulo, no marcado, sufragantes; validación en vivo de la regla contable (avisa, no bloquea); botón *Transmitir*; indicador de red | Jose |
| `/jurado/envios` | JURADO | Bandeja de salida/historial: *En cola (sin red)* → *Enviando* → *Registrada ✓* / *Ya estaba registrada ✓* / *Versión obsoleta* / *En verificación* / *Rechazada — retransmitir*; botón *Corregir* (crea versión +1); comprobante (id, versión, hora, instancia) | Jose |
| `/verificacion` | AUDITOR, COORDINADOR | Cola en vivo ordenada por prioridad; casos tomados por otros aparecen bloqueados con el nombre; botón *Tomar* | Meneses |
| `/verificacion/:acta` | AUDITOR, COORDINADOR | Foto del acta + valores digitados + descuadre resaltado; acciones *Aprobar*, *Aprobar con corrección*, *Rechazar*; indicador del bloqueo (renovando / por expirar por inactividad) | Meneses |
| `/coordinacion` | COORDINADOR | Lista de presencia: auditor, instancia, caso actual, desde hace cuánto, estado; contadores de cola (pendientes / en curso / resueltos) | Meneses |
| `/ops` | ADMIN | Tablero RT-7: conexiones por instancia, mensajes/s, retraso del Event Loop (p50/p99/max), memoria por conexión, actas/min, latencia recepción→publicación, mensajes reales vs ingenuos, INP p75, reconexiones/s | Evelyn (UI) / Meneses (recolección) |

---

## 6. Modelo de datos

### 6.1 Catálogo (sintético, determinista)
1 departamento, **30 municipios**, **1.842 puestos**, **6.400 mesas**, candidatos `C1…C5` + `BLANCO`, `NULO`, `NO_MARCADO`. Se genera con `pnpm seed` (semilla fija) y se guarda en:
- `packages/shared/catalogo.json` (nombres e ids para los selectores del frontend — sin depender del backend),
- Supabase (`municipios`, `puestos`, `mesas`, `candidatos`),
- Redis (`cat:mesa:{id}` → puesto, municipio, habilitados; `cat:n:puesto:{id}`, `cat:n:mun:{id}`, `cat:n:dep` → número de mesas, para el % informado).

### 6.2 Supabase (Postgres)
```sql
usuarios(id uuid pk, username text unique, password_hash text, rol text, nombre text, mesa int null)
municipios(id int pk, nombre text)
puestos(id int pk, municipio int fk, nombre text)
mesas(id int pk, puesto int fk, numero int, habilitados int)
candidatos(id text pk, nombre text, partido text, color text)
actas_versiones(acta_id text, version int, mesa int, puesto int, municipio int, jurado text,
                votos jsonb, sufragantes int, hash_foto text, foto_path text null,
                estado text, idem text, instancia text, recibida_en timestamptz,
                primary key (acta_id, version))
verificaciones(id bigserial pk, acta_id text, version int, auditor text, decision text,
               votos_corregidos jsonb null, motivo text, fencing bigint, creado_en timestamptz)
```
Storage: bucket privado `actas-fotos`, ruta `{acta_id}/v{version}.jpg`; los auditores la ven con URL firmada.

### 6.3 Reglas de negocio del acta
- **Regla contable**: `Σ votos de candidatos + BLANCO + NULO + NO_MARCADO = sufragantes`.
- Un acta es **dudosa** si: no cuadra, `sufragantes > habilitados`, o llega la **misma versión con contenido distinto** (conflicto).
- **Estado del acumulado de un acta = su versión máxima recibida**:
  - si la versión máxima es válida → esa es la que suma;
  - si es dudosa → el acta aporta 0 hasta que un auditor la resuelva (si había una versión anterior aplicada, se revierte con evento `motivo: EN_VERIFICACION`);
  - versiones menores que llegan tarde se responden `OBSOLETA` y no tocan nada.
  - ⇒ el resultado depende solo del **conjunto** de actas (y de las decisiones de auditoría), nunca del orden (RF-2).
- La resolución de un auditor (aprobar / aprobar con corrección) se aplica con **el mismo script Lua** como una versión aprobada.

---

## 7. Contratos compartidos (`packages/shared`) — **la base para no pisarse**

Todo lo que cruza de un módulo a otro vive en `packages/shared` y **solo cambia por PR aprobado por los tres**. Contiene:

- `types.ts` y `schemas.ts` (zod): `ActaEnvio`, `ActaRecibo`, `EventoAcumulado`, `MensajePublico`, `MensajeWs*`, `Rol`, `JwtPayload`.
- `redisKeys.ts`: funciones que construyen **todas** las claves (nadie escribe una clave a mano).
- `topics.ts`: `dep`, `mun:{id}`, `puesto:{id}`.
- `catalogo.json`.

### 7.1 API HTTP

| Método y ruta | Rol | Dueño | Respuesta |
|---|---|---|---|
| `POST /api/auth/login` | — | Meneses | `{ token, usuario }` |
| `GET /api/whoami` | — | Meneses | `{ instancia, redis: "ok"\|"degradado" }` |
| `GET /api/health` | — | Meneses | 200 / 503 |
| `POST /api/actas` | JURADO | Jose | `ActaRecibo` (ver 7.2). Header `Idempotency-Key` = `idem` |
| `PUT /api/actas/:acta/v/:version/foto` | JURADO | Jose | 204 (sube a Supabase Storage; reintentable) |
| `GET /api/actas/mias` | JURADO | Jose | Lista de estados; soporta `ETag`/`If-None-Match` → 304 |
| `GET /api/publico/stream?topics=dep,mun:11` | público | Evelyn | SSE (ver 7.3); lee `Last-Event-ID` o `?lastEventId=` |
| `GET /api/publico/snapshot?topic=mun:11` | público | Evelyn | `{ id, topic, totales, mesas: {informadas,total} }` |
| `POST /api/vitals` | público | Evelyn | 204 (muestras INP) |
| `GET /ws/verificacion` | AUDITOR, COORD. | Meneses | WebSocket (ver 7.4) |
| `GET /api/verificacion/:acta/foto` | AUDITOR | Meneses | redirección a URL firmada |
| `GET /api/ops/stream` | ADMIN | Meneses | SSE con métricas agregadas de todas las instancias |

Rate-limit (`core/rateLimit`, Meneses): contador por ventana fija por credencial — jurado 20 req/min por `sub`, login 10/min por IP, apertura de stream público 30/min por IP. Exceso → **429** con `Retry-After` y cuerpo `{ error: "RATE_LIMIT", reintentarEn }`.

### 7.2 Recibo de acta (respuesta siempre inequívoca — RF-1)
```ts
type ActaRecibo = {
  acta: string; version: number;
  resultado:
    | "REGISTRADA"          // primera vez, sumó
    | "YA_REGISTRADA"       // reenvío idéntico: mismo recibo original, no sumó otra vez
    | "OBSOLETA"            // ya hay una versión mayor
    | "EN_VERIFICACION"     // registrada, pero dudosa (no suma hasta revisión)
    | "CONFLICTO"           // misma versión con contenido distinto → a verificación
    | "NO_REGISTRADA";      // Redis caído / error: el cliente DEBE reintentar (HTTP 503)
  motivo?: string; instancia: string; registradaEn?: number; reciboId?: string;
};
```

### 7.3 Evento en Redis y mensaje SSE público
**Stream `ev:all`** (lo escribe el Lua de Jose; lo lee Evelyn). Cada entrada:
```
acta, version, tipo (APLICADA|CORRECCION|REVERSION), motivo,
ts_rx (ms de recepción, para medir latencia),
mesa, puesto, mun,
abs  = JSON { "dep": {C1:…, …, _inf:…}, "mun:11": {…}, "puesto:176": {…} }
```
`abs` lleva los **valores absolutos nuevos solo de los campos que cambiaron** en cada nivel (`_inf` = mesas informadas). Con valores absolutos, aplicar dos veces o solapar ventanas es inofensivo.

**Mensaje SSE** (lo emite Evelyn):
```
id: <id del stream del último evento incluido>
event: delta            # o: snapshot | estado | reconectar
data: {"topic":"mun:11","cambios":{"C1":10234,"_inf":143},"motivos":[{"acta":"E14-…","tipo":"CORRECCION"}],"ts_rx_min":…}
```

### 7.4 Protocolo WebSocket de verificación (Meneses)
Cliente → servidor: `hola`, `tomar {acta}`, `latido {actividad: ts}`, `resolver {acta, token, decision, votos?, motivo}`, `soltar {acta, token}`.
Servidor → cliente: `estado_cola {items}` (fotografía completa al conectar), `caso_tomado {acta, auditor}`, `caso_liberado {acta}`, `caso_nuevo {item}`, `caso_resuelto {acta}`, `tomado_ok {acta, token, expiraEn}`, `error {codigo}`, `presencia {lista}` (solo coordinador).

### 7.5 Interfaz entre módulos (en código)
- Jose expone `ActasService.aplicarResolucion({ acta, version, votos, decision, auditor, fencing })` — Meneses la llama al resolver un caso. Hasta que exista, Meneses usa un stub con la misma firma.
- Jose deja cada acta dudosa en `verif:queue` + `verif:case:{acta}` (formato en `redisKeys.ts`). Meneses solo lee/gestiona.
- Meneses expone `core/metrics` (`metrics.inc(nombre)`, `metrics.observe(nombre, valor)`, `metrics.gauge(nombre, fn)`) y `core/redis` (`redis`, `redisSub`, `estadoRedis()`); los demás solo los usan.

---

## 8. Diseño en Redis (papel obligatorio §5 del caso)

| Papel | Claves / estructura | Detalle | Dueño |
|---|---|---|---|
| **Idempotencia** (RF-1) | `idem:{idem}` STRING (JSON del recibo), `SET NX EX 86400` | Reenvío → se devuelve el mismo recibo. Si la clave expiró antes del reintento, la segunda barrera es `acta:{id}`: misma versión + mismo hash → `YA_REGISTRADA`; misma versión + otro contenido → `CONFLICTO`. Nunca suma dos veces. | Jose |
| **Registro de actas** | `acta:{id}` HASH (`vmax`, `vaplicada`, `estado`, `votos` JSON, `hash`, `mesa`, `puesto`, `mun`); `acta:{id}:v:{n}` JSON por versión; `jurado:{sub}:actas` SET | Base del polling del jurado y de la verificación | Jose |
| **Acumulados** (RF-3) | `tot:mesa:{id}`, `tot:puesto:{id}`, `tot:mun:{id}`, `tot:dep` HASH (candidato→votos, `_inf`, `_suf`); `rank:puesto:{id}`, `rank:mun:{id}`, `rank:dep` ZSET | Lectura O(1) por nivel; **ranking con `ZREVRANGE … WITHSCORES`** sin recorrer nada | Jose |
| **Operación atómica compuesta** (RF-2/RF-3) | `lua/aplicar_acta.lua` | En un solo script: idempotencia → comparación de versión → revertir la aplicada → aplicar la nueva en 4 niveles + rankings + `_inf` → `XADD ev:all` + `XADD ev:actas` → encolar dudosas → guardar recibo. Redis ejecuta un script sin intercalar otros comandos, así que **nadie puede leer un municipio actualizado con su puesto sin actualizar**. Con comandos sueltos (o incluso `MULTI` sin lógica condicional) otro cliente lee entre comandos, y un fallo a mitad deja niveles inconsistentes. Restricciones: el script debe ser corto (bloquea Redis mientras corre), declarar sus claves en `KEYS` (en Cluster todas tendrían que estar en el mismo slot → usaríamos un hash tag `{e}`; aquí es una sola instancia) y no hacer I/O externo. | Jose |
| **Backplane + historial** (RF-4/RF-6) | `ev:all` **STREAM**, `XADD … MAXLEN ~ 50000` | Un canal **global**: el flujo de escritura es pequeño (~7.000 eventos en la jornada, pico ~5/s), así que cada instancia lee *todo* con `XREAD BLOCK` y filtra localmente por tópico; el tráfico entre Redis e instancias es 8 × ~5 eventos/s, despreciable. Un canal por tópico solo compensaría con volúmenes de escritura mucho mayores y complica el replay. Ids **monótonos** del stream = `Last-Event-ID`. Retención: 50.000 entradas (cubre la jornada entera, ~300 B c/u ≈ **15 MB**; se mide con `MEMORY USAGE`). **No se usa Pub/Sub para el público** porque no tiene memoria. | Jose escribe / Evelyn lee |
| **Persistencia diferida** | `ev:actas` STREAM + consumer group `persist` | Un worker por instancia hace `XREADGROUP`; cada evento lo procesa **una** instancia; `XACK` tras insertar en Supabase; `XAUTOCLAIM` recupera pendientes de una instancia muerta | Jose |
| **Bloqueo distribuido** (RF-7) | `lock:acta:{id}` STRING = `{auditor}:{token}` `SET NX PX 30000`; `fence:seq` INCR; `verif:queue` ZSET; `verif:taken` HASH | Lease renovado por latido; liberación/resolución con Lua *compare-and-delete* verificando el token; token de *fencing* monótono rechaza al auditor tardío | Meneses |
| **Presencia** (RF-8) | `presence:{sub}` STRING JSON `EX 30`; `presence:idx` ZSET (score = último latido) | Latido cada 10 s; si no llega en 30 s la clave expira sola; la lista se arma con `ZRANGEBYSCORE idx (ahora-30s) +inf` y se poda lo viejo | Meneses |
| **Difusión a auditores** | Pub/Sub `ch:verif`, `ch:presence` | Aquí Pub/Sub **sí** sirve: al (re)conectar, el auditor recibe la fotografía completa de la cola (pequeña), así que no necesita historial | Meneses |
| **Límite de tasa** | `rl:{cred}:{ventana}` INCR + EXPIRE | Ventana fija de 60 s | Meneses |
| **Métricas** | `metrics:inst:{id}` HASH `EX 10`; `metrics:instances` ZSET | Cada instancia publica cada 2 s; el tablero agrega | Meneses |

---

## 9. Flujos clave

### 9.1 Ingesta (RF-1, RF-2, RF-3)
1. App del jurado guarda el acta en su **outbox** (IndexedDB) con `idem` generado una sola vez (`crypto.randomUUID`) y `hash_foto` (SHA-256 de la foto, Web Crypto).
2. Intenta `POST /api/actas` con backoff + jitter mientras no tenga un recibo definitivo.
3. Servidor: JWT → rate-limit → zod → regla contable → `aplicar_acta.lua` → responde `ActaRecibo`.
4. La foto se sube aparte (`PUT …/foto`) — fuera del camino crítico.

**¿Y si el servidor cae entre registrar y confirmar?** El Lua es atómico: o se aplicó todo o nada. Si se aplicó y la respuesta se perdió, el jurado (que no vio confirmación) reintenta con el **mismo `idem`** → `YA_REGISTRADA` con el recibo original. Entrega *al menos una vez* + procesamiento idempotente = efecto *exactamente una vez*.

### 9.2 Difusión al público (RF-4, RF-5, RF-6, RF-9)
1. Cada instancia tiene un lector `XREAD BLOCK` sobre `ev:all` y un **acumulador por ventana** (`WINDOW_MS = 2000`): por tópico, fusiona los `abs` (último valor gana) y recuerda el último id.
2. Al cerrar la ventana, por cada tópico con cambios **y con suscriptores**: serializa **una vez** el mensaje y lo envía a `TopicRegistry.get(topic)` (un `Map<string, Set<Conn>>`: alta O(1), baja O(1), recorrido O(suscriptores del tópico)) **en lotes de 500**, cediendo con `await setImmediate()` entre lotes.
3. **Reconexión**: el cliente manda su último id. El servidor hace `XRANGE ev:all (id +` filtrado por tópico y le envía un único `delta` fusionado; si el id ya no está en el stream, si hay más de 2.000 eventos pendientes o pasaron más de 10 min → manda `snapshot` (leído con un Lua que toma el hash del tópico y el último id del stream de forma atómica). Luego entra al registro en vivo; las ventanas que terminan antes de su id se saltan para esa conexión.
4. **Contrapresión** por conexión: si `writableLength > 64 KB` deja de recibir deltas y queda marcada; al vaciarse (`drain`) recibe un `snapshot`. Si supera 512 KB o lleva 30 s atrasada → `event: reconectar` y se cierra; el cliente vuelve con su id.

### 9.3 Verificación (RF-7, RF-8)
1. `tomar`: Lua → `SET lock NX PX 30000` + `ZREM verif:queue` + `HSET verif:taken` + `INCR fence:seq` → `tomado_ok {token}` y `PUBLISH ch:verif caso_tomado`. Todas las consolas lo ven sin recargar.
2. **Tensión expirar vs. seguir trabajando**: el lock dura 30 s y el cliente lo renueva con un `latido` cada 10 s (Lua: renueva solo si el token es suyo). Pero el latido solo renueva si hubo **actividad real** (mouse/teclado/scroll) en los últimos 5 min. Navegador cerrado o red caída → no hay latido → vuelve a la cola en ≤ 30 s. Auditor almorzando con la pestaña abierta → hay socket pero no actividad → vuelve a la cola en ≤ 5 min. Auditor trabajando → nunca expira.
3. **Reaper**: cada instancia ejecuta cada 5 s `reaper.lua`: para cada caso en `verif:taken` cuyo lock ya no existe → lo devuelve a la cola y publica `caso_liberado`. Es idempotente; que lo corran las 8 instancias no causa problema.
4. **Liberación segura**: `resolver`/`soltar` exigen el token; el Lua hace *compare-and-delete* (`if GET lock == token then DEL`). Un auditor cuyo lock expiró y fue reasignado tiene un token viejo → `error LOCK_PERDIDO`, no libera ni resuelve nada. Además el `fencing` monótono se guarda con la resolución en Supabase.

### 9.4 Degradación (RF-10)
- **Redis no responde**: ioredis con `enableOfflineQueue: false`, `commandTimeout: 500 ms` y estado `degradado` en `core/redis`. Ingesta → **503 `NO_REGISTRADA`** explícito; la app del jurado muestra *"No registrada — guardada en tu teléfono, se reenviará sola"* y sigue reintentando. El público recibe `event: estado {pausado: true, desde}` y ve "Actualizaciones pausadas" con el último dato. Las consolas de auditoría deshabilitan acciones. Nunca hay silencio.
- **Avalancha**: cuando cae una instancia, sus clientes reintentan con **backoff exponencial + full jitter** (`espera = random(0, min(30 s, 500 ms · 2^intento))`) y el servidor manda `retry:` en SSE. Se grafica reconexiones/s con y sin jitter (`loadtest/avalancha`).

---

## 10. Estructura del repositorio y propiedad

```
electoral/
├─ apps/
│  ├─ server/src/
│  │  ├─ main.ts, app.ts                 # Meneses (cada uno agrega 1 línea para su módulo)
│  │  ├─ core/                           # Meneses: config, redis, supabase, auth, rateLimit,
│  │  │                                  #          metrics, eventLoop, transport/, instance
│  │  └─ modules/
│  │     ├─ actas/                       # Jose
│  │     ├─ publico/                     # Evelyn
│  │     ├─ verificacion/  (incl. presencia) # Meneses
│  │     └─ ops/                         # Meneses
│  └─ web/src/
│     ├─ app/ (router, layout, auth, guards)  # Meneses
│     ├─ shared/ui/ (sistema de diseño)       # Evelyn
│     ├─ shared/net/ (backoff, sse, http)     # Evelyn (backoff) / Jose (http con outbox)
│     └─ features/
│        ├─ jurado/                      # Jose
│        ├─ publico/                     # Evelyn
│        ├─ ops/                         # Evelyn
│        └─ verificacion/, coordinacion/ # Meneses
├─ packages/shared/                      # TODOS — solo por PR aprobado por los tres
├─ supabase/migrations/                  # cada uno su archivo numerado
├─ scripts/seed.ts                       # Jose
├─ loadtest/                             # Evelyn
├─ infra/ (docker-compose.yml, nginx.conf, redis.conf, deploy.md)  # Meneses
└─ docs/ (GENERAL.md, tareas/, informe/)
```

### Reglas de trabajo para no pisarse
1. **Cada uno solo edita sus carpetas.** Si necesitas algo de otro módulo, usas su interfaz pública o pides el cambio.
2. `packages/shared` se cambia por PR con aprobación de los tres; los cambios son *aditivos* (no renombrar sin avisar).
3. Ramas `feat/<persona>-<tema>`, PR a `main` con al menos una revisión, *Conventional Commits*. Agregar `CODEOWNERS` con estas carpetas.
4. Migraciones de Supabase con prefijo numérico por persona para no chocar: Meneses `001_*`, Jose `010_*`, Evelyn `020_*`.
5. Cada quien trabaja contra el `docker compose up` local (Redis + 2 instancias + nginx) y **mocks**: Evelyn puede generar eventos en `ev:all` con `scripts/fake-events.ts` sin esperar a Jose; Meneses puede encolar dudosas falsas sin esperar a Jose.

### Paso 0 (en paralelo, antes de lo demás)
- **Meneses**: monorepo pnpm, `apps/server` con `core/` mínimo (config, redis, health, whoami), `docker-compose` local, nginx, `CODEOWNERS`.
- **Jose**: proyecto Supabase, migraciones de catálogo, `scripts/seed.ts` → `catalogo.json` + Redis.
- **Evelyn**: `apps/web` con Vite + Tailwind + shadcn/ui, layout base y tokens de diseño.
- **Los tres juntos**: escribir `packages/shared` (tipos, schemas, `redisKeys.ts`, topics) a partir del §7 y §8 de este documento.

---

## 11. Mediciones e instrumentación (RT-4, RT-7, RT-9, justificación de transportes)

Métricas por instancia (recolectadas en `core/metrics`, publicadas cada 2 s):

| Métrica | Cómo |
|---|---|
| Conexiones por instancia (SSE, WS) | contadores en `TopicRegistry` y gateway WS |
| Mensajes emitidos/s y total | contador en el fan-out; **comparar contra el ingenuo** `actas × clientes` |
| Retraso del Event Loop p50/p99/max | `perf_hooks.monitorEventLoopDelay({ resolution: 10 })` |
| Memoria por conexión | `(rss − rss_base) / conexiones` y `heapUsed / conexiones` |
| Actas por minuto | contador en ingesta |
| Latencia recepción → publicación | `ahora − ts_rx` al enviar cada lote (p50/p99) |
| Reconexiones/s | contador de aperturas de stream con `Last-Event-ID` |
| INP | `web-vitals` en `/resultados` → `POST /api/vitals` → p75 en el tablero |

Para **defender cada transporte con datos** (no opinión), el informe incluye una tabla medida con `loadtest/`:
- costo de memoria por conexión SSE vs WS (mismo número de clientes),
- bytes por actualización (frame WS vs evento SSE vs respuesta de polling),
- carga del servidor del polling del jurado (req/s con 6.400 jurados cada 15 s, % de 304),
- tiempo de recuperación tras corte de red: POST idempotente vs WS.

---

## 12. Pruebas (solo las necesarias)

| Garantía | Prueba | Dueño |
|---|---|---|
| RF-1 idempotencia | El mismo acta 5 veces → suma una vez, 5 recibos coherentes | Jose |
| RF-2 convergencia | Mismas versiones en orden aleatorio (varias permutaciones) → mismo acumulado | Jose |
| RF-3 atomicidad | Tras N actas, `tot:dep` = Σ municipios = Σ puestos | Jose |
| RF-6 continuidad | Cliente que se desconecta y vuelve con su id = cliente que nunca se fue | Evelyn |
| RF-4 fan-out | 50.000 conexiones simuladas, retraso del Event Loop p99 acotado | Evelyn |
| RF-9 contrapresión | Cliente lento → recibe snapshot o `reconectar`, la memoria no crece sin límite | Evelyn |
| RF-7 exclusividad | Dos auditores toman el mismo caso a la vez → solo uno gana | Meneses |
| RF-7 liberación segura | Token viejo no libera ni resuelve | Meneses |
| RF-8 presencia | Sin latido → desaparece en ≤ 30 s | Meneses |
| RF-10 Redis caído | Ingesta responde 503 `NO_REGISTRADA`, no 200 | Meneses + Jose |

Las pruebas de carga (RT-8: ≥ 20.000 conexiones, perfil de la jornada, avalancha, cliente lento) viven en `loadtest/` y se ejecutan en la sustentación.

---

## 13. Despliegue (RT-1, RT-10)
- `infra/docker-compose.yml` levanta `nginx`, `app1…app8` (misma imagen, `INSTANCE_ID` distinto), `redis` (AOF). Variables en `.env` (`JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `WINDOW_MS`, …) con `.env.example` en el repo.
- VM en la nube con IP pública (y dominio gratuito opcional), `ulimit -n` alto (≥ 200.000) y `net.ipv4.ip_local_port_range` ampliado; Node con `--max-old-space-size` ajustado.
- `infra/deploy.md` con los pasos para que cualquiera lo despliegue desde cero.
- Para generar 20.000+ conexiones, el cliente de carga se reparte en varios procesos (y si hace falta en 2 máquinas) por el límite de puertos efímeros.

---

## 14. Informe — qué debe explicar (y quién lo redacta)

| Pregunta del caso | Sección | Quién |
|---|---|---|
| Caída entre registrar y confirmar (RF-1) | §9.1 | Jose |
| Convergencia fuera de orden (RF-2) | §6.3 | Jose |
| Atomicidad con Lua y por qué no basta con comandos seguidos (RF-3) | §8 | Jose |
| Clave de idempotencia que expira antes del reintento | §8 | Jose |
| Ventanas de agregación, delta mínimo, mensajes reales vs ingenuos (RF-4) | §9.2 | Evelyn |
| Estructura tópico→conexiones y su costo (RF-5) | §9.2 | Evelyn |
| Continuidad: identificador, replay vs fotografía, retención y memoria del stream (RF-6) | §8, §9.2 | Evelyn |
| Política de clientes lentos (RF-9) | §9.2 | Evelyn |
| Avalancha: gráfica con y sin jitter (RF-10) | §9.4 | Evelyn |
| Lock con lease, renovación, inactividad y fencing (RF-7) | §9.3 | Meneses |
| Presencia con latido y TTL (RF-8) | §8 | Meneses |
| Sin sesiones pegajosas (RT-2) y diseño de canales | §3.3, §8 | Meneses |
| Redis caído (RF-10) | §9.4 | Meneses |
| Elección de transportes con mediciones | §1, §11 | Los tres |
