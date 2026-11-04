# Jose — Jurados e ingesta de actas

> Lee primero `docs/GENERAL.md` (§6, §7, §8 y §9.1 son tu contrato).
> Eres dueño del **corazón contable**: que un acta entre una sola vez, converja sin importar el orden y actualice los 4 niveles de forma atómica.

**Requerimientos que cubres:** RF-1, RF-2, RF-3, RT-6, parte de RF-10 (lado jurado), persistencia en Supabase, catálogo y seed.

## Tus carpetas (solo tú las editas)
```
apps/server/src/modules/actas/
apps/web/src/features/jurado/
apps/web/src/shared/net/http.ts          # cliente HTTP con outbox
scripts/seed.ts
supabase/migrations/010_*.sql
```

## Lo que produces para los demás
| Para | Qué | Dónde |
|---|---|---|
| Evelyn | Eventos en `ev:all` con el formato de GENERAL §7.3 (campo `abs` con valores absolutos de lo que cambió por nivel) | `aplicar_acta.lua` |
| Evelyn | Hashes `tot:*` y `cat:n:*` para el snapshot | Redis |
| Evelyn / Meneses | `packages/shared/catalogo.json` | `scripts/seed.ts` |
| Meneses | Actas dudosas en `verif:queue` + `verif:case:{acta}` | `aplicar_acta.lua` |
| Meneses | `ActasService.aplicarResolucion(...)` | `modules/actas/actas.service.ts` |

## Lo que consumes
`core/redis`, `core/supabase`, `core/auth` (guard por rol), `core/rateLimit`, `core/metrics` de Meneses. Mientras no estén, usa un `ioredis` directo y quítalo cuando lleguen.

---

## Tareas

### 1. Supabase, catálogo y seed
- [ ] **Eres el administrador de Supabase**: creas el proyecto (región `us-east-1`), invitas a Evelyn y Meneses como miembros, creas el bucket privado `actas-fotos` y aplicas las migraciones de los tres (`001_*`, `010_*`, `020_*`) con `supabase db push` o el *SQL Editor*. Pasas `SUPABASE_URL` y la clave `service_role` por un canal privado, nunca por el repo.
- [ ] Migración `010_catalogo.sql`: `municipios`, `puestos`, `mesas`, `candidatos`, `actas_versiones`, `verificaciones` (ver GENERAL §6.2). Bucket `actas-fotos` privado.
- [ ] `scripts/seed.ts` con semilla fija: 30 municipios, 1.842 puestos, 6.400 mesas (habilitados 300–700), candidatos C1–C5 con nombre y color.
  - Escribe `packages/shared/catalogo.json`.
  - Carga Supabase (upsert).
  - Carga Redis: `cat:mesa:{id}` (puesto, mun, habilitados, actaId), `cat:n:puesto:{id}`, `cat:n:mun:{id}`, `cat:n:dep`.
  - Crea usuarios demo de jurado (uno por mesa, contraseña común de demo **solo para el entorno de pruebas**, guardada en `.env.example`) — coordínalo con Meneses que crea la tabla `usuarios`.
- [ ] `scripts/fake-acta.ts`: envía un acta válida/dudosa/corrección por HTTP (te sirve a ti y a los demás para probar).

### 2. `aplicar_acta.lua` (la pieza más importante)
Entrada: `KEYS` = idem, acta, versión, tot mesa/puesto/mun/dep, rank puesto/mun/dep, ev:all, ev:actas, verif:queue, verif:case. `ARGV` = JSON del acta, `esDudosa`, `motivo`, `ts_rx`, `instancia`.

Lógica (todo dentro del script):
1. Si existe `idem:{idem}` → devolver el recibo guardado con `resultado = YA_REGISTRADA`.
2. Leer `acta:{id}` (`vmax`, `vaplicada`, `hash`).
   - `version < vmax` → `OBSOLETA` (guardar recibo con idem, no tocar acumulados).
   - `version == vmax` y mismo hash de contenido → `YA_REGISTRADA` (cubre idem expirado).
   - `version == vmax` y contenido distinto → `CONFLICTO` → a verificación.
3. `version > vmax`:
   - Si había versión aplicada → **restar** sus votos en los 4 niveles + rankings.
   - Si la nueva es válida → **sumar** en los 4 niveles + rankings; `_inf` +1 solo si la mesa no estaba informada.
   - Si es dudosa → no suma (si antes estaba informada, `_inf` −1), encolar en `verif:queue` con prioridad (`ts` menos bonificación si `version > 1` o descuadre grande) y `verif:case:{acta}`.
   - Actualizar `acta:{id}`, `acta:{id}:v:{n}`, `jurado:{sub}:actas`.
4. `XADD ev:all MAXLEN ~ 50000 *` con `abs` = valores absolutos nuevos de los campos que cambiaron en cada nivel (`dep`, `mun:X`, `puesto:Y`) + `tipo`/`motivo`/`ts_rx`. Solo si algo cambió.
5. `XADD ev:actas MAXLEN ~ 20000 *` con el acta completa (para persistir).
6. `SET idem:{idem} <recibo> EX 86400`. Devolver recibo.

- [ ] Registrar con `redis.defineCommand('aplicarActa', …)`; las claves salen de `redisKeys.ts`.
- [ ] `aplicarResolucion()` reutiliza el mismo script con un flag `aprobada` (trata la versión resuelta como válida; *Aprobar con corrección* usa los votos corregidos).

### 3. Endpoints (`modules/actas`)
- [ ] `POST /api/actas`: guard `JURADO`, la mesa del body debe ser la del JWT, rate-limit, zod, regla contable (`Σ candidatos + BLANCO + NULO + NO_MARCADO = sufragantes`) y `sufragantes ≤ habilitados` → `esDudosa`. Llama al Lua y responde `ActaRecibo` (201 `REGISTRADA`, 200 para el resto, **503 `NO_REGISTRADA`** si Redis falla — nunca 200 sin haber escrito).
- [ ] `PUT /api/actas/:acta/v/:version/foto`: multipart → Supabase Storage `actas-fotos/{acta}/v{n}.jpg`; verifica el SHA-256 contra `hash_foto`; idempotente (`upsert`).
- [ ] `GET /api/actas/mias`: estados de las actas del jurado; `ETag` = hash del contenido, `If-None-Match` → 304.
- [ ] Métricas: `metrics.inc('actas_recibidas')`, por resultado, y duración del Lua.

### 4. Worker de persistencia
- [ ] Al arrancar: `XGROUP CREATE ev:actas persist $ MKSTREAM` (ignorar si existe).
- [ ] Bucle `XREADGROUP GROUP persist <INSTANCE_ID> BLOCK 5000 COUNT 50` → upsert en `actas_versiones` → `XACK`.
- [ ] Cada 30 s `XAUTOCLAIM` de mensajes pendientes > 60 s (instancia muerta).
- [ ] Si Supabase falla, no hace `XACK` y reintenta; no afecta la ingesta.
- Usa una conexión ioredis **dedicada** (las lecturas bloqueantes no deben compartir conexión).

### 5. App del jurado (`features/jurado`) — RT-6
- [ ] PWA (`vite-plugin-pwa`): la ruta `/jurado` abre sin red después de la primera visita.
- [ ] **Outbox** en IndexedDB (`idb-keyval`): cada envío `{ idem, acta, version, payload, fotoBlob, estado, intentos }`. El `idem` se genera **una vez** al crear el envío, nunca en el reintento.
- [ ] Despachador: al cargar, en `online` y con temporizador; backoff exponencial + full jitter (usa `shared/net/backoff.ts` de Evelyn); timeout de 10 s por intento. Solo un recibo definitivo (`REGISTRADA`, `YA_REGISTRADA`, `OBSOLETA`, `EN_VERIFICACION`, `CONFLICTO`) saca el acta de la cola; `NO_REGISTRADA`, timeout o red caída → sigue en cola.
- [ ] Después del recibo, sube la foto con su propia cola de reintentos.
- [ ] Polling de `/api/actas/mias` cada 15 s con `If-None-Match` (pausado si la pestaña está oculta) para ver *En verificación → Aprobada / Rechazada*.
- [ ] Pantallas (GENERAL §5): formulario con cámara (`<input type="file" accept="image/*" capture="environment">`, comprimir a ~1280 px en canvas), campos numéricos grandes para móvil, total en vivo con aviso si no cuadra, *Corregir* = versión +1; bandeja con chips de estado claros y comprobante.
- [ ] Indicador de red y del estado del servidor (si `NO_REGISTRADA`: "No registrada. Está guardada en tu teléfono y se enviará sola").

## Pruebas necesarias (vitest + Redis real)
1. **Idempotencia**: el mismo acta 5 veces → `tot:dep` suma una vez; 1 `REGISTRADA` + 4 `YA_REGISTRADA`.
2. **Idem expirado**: borrar `idem:*` y reenviar → `YA_REGISTRADA`, no suma.
3. **Convergencia**: versiones 1, 2, 3 de varias actas en 10 permutaciones aleatorias → mismo `tot:dep`, mismos `tot:mun:*`.
4. **Atomicidad / consistencia**: tras 500 actas aleatorias, `tot:dep` = Σ `tot:mun:*` = Σ `tot:puesto:*`.
5. **Redis caído** (con Meneses): detener Redis → `POST /api/actas` responde 503 `NO_REGISTRADA`.

## Definición de terminado
- Un acta enviada desde el celular con la red cortada se transmite sola al volver la red y aparece en `/resultados`.
- Las 5 pruebas pasan.
- Sección del informe: RF-1 (incluida la caída entre registrar y confirmar), RF-2, RF-3 (por qué Lua y no comandos seguidos), idem que expira.
