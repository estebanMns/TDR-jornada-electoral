# Evelyn — Público en tiempo real, fan-out y pruebas de carga

> Lee primero `docs/GENERAL.md` (§1, §7.3, §8 fila *Backplane*, §9.2, §9.4 y §11 son tu contrato).
> Eres dueña de la audiencia más grande: **400.000 navegadores** que deben ver lo mismo, rápido, sin tumbar el servidor. También del sistema de diseño (que todo se vea bien) y de las pruebas de carga.

**Requerimientos que cubres:** RF-4, RF-5, RF-6, RF-9, RF-10 (avalancha + vista pública degradada), RT-4, RT-8, RT-9, UI del tablero RT-7.

## Tus carpetas (solo tú las editas)
```
apps/server/src/modules/publico/
apps/web/src/features/publico/
apps/web/src/features/ops/
apps/web/src/shared/ui/              # sistema de diseño
apps/web/src/shared/net/backoff.ts   # lo usan todos
apps/web/src/shared/net/sse.ts
loadtest/
scripts/fake-events.ts
supabase/migrations/020_*.sql        # solo si necesitas algo
```

## Lo que consumes
- `ev:all` y `tot:*` / `cat:n:*` que escribe Jose (formato GENERAL §7.3). **No lo esperes**: `scripts/fake-events.ts` hace `XADD ev:all` con el mismo formato a ~5 eventos/s y ráfagas.
- `core/transport/ClientConnection`, `core/metrics`, `core/redis` (`estadoRedis()`) de Meneses.
- `GET /api/ops/stream` de Meneses para el tablero.

---

## Tareas

### 1. Sistema de diseño (Paso 0)
- [ ] Tailwind + shadcn/ui, tokens de color (incluye un color por candidato desde `catalogo.json`), tipografía Inter, modo claro/oscuro.
- [ ] Componentes base: `Card`, `Badge` de estado, `StatusDot` (en vivo / reconectando / pausado), `BarRow` (barra de candidato), `Stat`, `PageShell`.
- [ ] Publicar en `shared/ui` para que Jose y Meneses los usen.

### 2. Módulo `publico` (servidor)
- [ ] **Lector del stream**: conexión ioredis dedicada, bucle `XREAD BLOCK 1000 STREAMS ev:all <cursor>` desde `$` al arrancar. Mantiene `cursor` (último id procesado).
- [ ] **Acumulador por ventana** (`WINDOW_MS`, por defecto 2000): `Map<topic, { cambios, motivos, hastaId, tsRxMin }>`; para cada evento fusiona `abs[topic]` (último valor gana).
- [ ] **`TopicRegistry`**: `Map<string, Set<ClientConnection>>`. `add(topic, conn)` / `remove(topic, conn)` O(1); recorrer cuesta O(suscriptores del tópico), **no** O(conexiones de la instancia) (RF-5). Contadores de conexiones por tópico para métricas.
- [ ] **Fan-out por lotes** (RF-4): al cerrar ventana, por cada tópico con cambios y suscriptores: `JSON.stringify` una vez → enviar en lotes de `BATCH_SIZE = 500` → `await new Promise(setImmediate)` entre lotes. Saltar conexiones cuyo `lastId >= hastaId`. Contar mensajes enviados, y la cifra ingenua (`eventos × conexiones`).
- [ ] **Endpoint SSE** `GET /api/publico/stream?topics=dep,mun:11` (máx. 3 tópicos):
  - `reply.hijack()`, headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, primer `retry: <ms aleatorio>`.
  - Comentario `: ping` cada 25 s (mantiene vivo el proxy).
  - Lee `Last-Event-ID` o `?lastEventId=` (el cliente manual lo pasa por query).
  - Rate-limit de apertura por IP (`core/rateLimit`).
- [ ] **Continuidad (RF-6)**: con id → `XRANGE ev:all (<id> +` filtrando por tópico → un `delta` fusionado. Mandar `snapshot` si: no hay id, el id es anterior al primero del stream (`XINFO STREAM` → `first-entry`), hay > 2.000 eventos pendientes o pasaron > 10 min. Después registrar la conexión con `lastId` = último id enviado.
- [ ] **`snapshot.lua`**: devuelve `HGETALL tot:<topic>`, `cat:n:<topic>` y el último id de `ev:all` en una sola ejecución atómica. También `GET /api/publico/snapshot`.
- [ ] **Contrapresión (RF-9)** como `BackpressurePolicy` (Strategy): antes de cada envío mirar `conn.bufferedBytes()`.
  - `> 64 KB` → marcar `atrasada`, no enviar deltas; al `drain` → enviar `snapshot` y desmarcar.
  - `> 512 KB` o atrasada > 30 s → `event: reconectar` + cerrar. Métrica de clientes atrasados/desconectados.
- [ ] **Degradado**: si `estadoRedis()` pasa a `degradado`, enviar a todos `event: estado {pausado: true, desde}`; al recuperarse, `estado {pausado: false}` y reanudar desde el cursor (el stream no perdió nada).
- [ ] **INP**: `POST /api/vitals` guarda muestras (`LPUSH vitals:inp` + `LTRIM 1000`) y el p75 se publica como métrica.

### 3. Página pública (`features/publico`) — RT-9
- [ ] Cliente SSE propio en `shared/net/sse.ts`: usa `EventSource`, pero en `error` lo cierra y reconecta **manualmente** con backoff + full jitter (`backoff.ts`: `random(0, min(30 s, 500 ms·2^n))`), pasando `lastEventId` por query. Respeta `event: reconectar`.
- [ ] Estado en un store mínimo (sin re-render por mensaje): aplicar mensajes solo si `id > lastId`; **render agrupado en `requestAnimationFrame`**.
- [ ] Pantalla: selector municipio/puesto (datos de `catalogo.json`, sin pedir al backend), ranking con barras CSS (sin librería de gráficas), votos y %, **% mesas informadas**, hora del último dato, `StatusDot`; si un valor baja, aviso visible con el motivo ("Corrección del acta E14-…").
- [ ] Bundle mínimo: la ruta se carga perezosa y no importa shadcn pesado ni librerías de gráficas. Medir con Lighthouse en perfil móvil.
- [ ] `web-vitals` `onINP` → `navigator.sendBeacon('/api/vitals', …)`.

### 4. Tablero de operación (`features/ops`) — UI de RT-7
- [ ] Consume `GET /api/ops/stream` (de Meneses). Una tarjeta por instancia: conexiones SSE/WS, mensajes/s, Event Loop p50/p99/max, memoria por conexión, estado de Redis.
- [ ] Gráficas (uPlot o recharts, solo en esta ruta): mensajes/s, retraso del Event Loop, actas/min, latencia recepción→publicación, reconexiones/s.
- [ ] Contador grande: **mensajes reales vs ingenuos** y el factor de reducción. INP p75.

### 5. Pruebas de carga (`loadtest/`) — RT-8
- [ ] `loadtest/publico.ts`: abre N conexiones SSE crudas (`http.request`, sin `EventSource`) repartidas en `--procesos` (`child_process.fork`), con mezcla de tópicos (60 % `dep`, 35 % municipio, 5 % puesto). Objetivo ≥ 20.000 (meta 50.000). Mide latencia `ahora − ts_rx` de lo que recibe.
- [ ] `loadtest/jornada.ts`: simula 6.400 jurados con el perfil del caso: 55 % de las actas en los primeros 40 min con ráfagas de hasta 300/min, 4–11 % de reenvíos (mismo `idem`), ~180 correcciones, 6–9 % dudosas. Opción `--acelerar 10` para comprimir el tiempo. Firma JWT con `JWT_SECRET`.
- [ ] `loadtest/lento.ts`: cliente que lee el socket a 1 KB/s → demuestra RF-9.
- [ ] `loadtest/avalancha.ts`: con N clientes conectados, se hace `docker stop app3`; los clientes miden reconexiones/s. Corre con `--jitter on` y `--jitter off` y exporta CSV → gráfica en el informe (RF-10).
- [ ] `loadtest/README.md` con los comandos exactos para la sustentación (incluye `ulimit -n`).

## Pruebas necesarias
1. **Continuidad (RF-6)**: un cliente A conectado todo el tiempo y un cliente B que se desconecta 30 s y vuelve con su id → mismo estado final. Y B con id inexistente → recibe `snapshot` y queda igual.
2. **Fan-out (RF-4)**: 50.000 conexiones falsas en memoria (objetos `ClientConnection` simulados) + ráfaga de eventos → p99 del retraso del Event Loop por debajo de ~50 ms (comparar contra la versión sin lotes y reportar ambas).
3. **Contrapresión (RF-9)**: `loadtest/lento.ts` → el cliente recibe `snapshot`/`reconectar` y la memoria de la instancia se mantiene estable.

## Definición de terminado
- `/resultados` se actualiza en vivo en un celular, se recupera tras quitar y volver la red sin recargar, y muestra "pausado" si Redis cae.
- La prueba de carga levanta ≥ 20.000 conexiones contra el despliegue y el tablero lo muestra.
- Sección del informe: RF-4 (ventanas, delta mínimo, mensajes reales vs ingenuos), RF-5 (estructura y costos), RF-6 (id, replay vs snapshot, retención y memoria del stream con `MEMORY USAGE ev:all`), RF-9, gráfica de avalancha, INP bajo carga.
