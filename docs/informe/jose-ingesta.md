# Ingesta de actas: idempotencia, convergencia y atomicidad

> Sección del informe a cargo de Jose (RF-1, RF-2, RF-3). Código: `apps/server/src/modules/actas`
> y `apps/web/src/features/jurado`. Pruebas: `apps/server/test/actas.guarantees.test.ts`.

## 1. Un acta entra una sola vez (RF-1)

**Entrega al menos una vez + procesamiento idempotente = efecto exactamente una vez.**

1. Al pulsar *Transmitir*, la app del jurado guarda el envío en una bandeja de salida
   (IndexedDB) con una clave de idempotencia (`crypto.randomUUID`) generada **una sola vez**.
2. Un despachador reintenta `POST /api/actas` con esa misma clave (cabecera
   `Idempotency-Key`), con espera exponencial y *full jitter*, hasta obtener un recibo
   **definitivo**. Sin red, con *timeout* o con `NOT_REGISTERED` el envío sigue en cola,
   incluso si se cierra la pestaña.
3. En el servidor, `apply_acta.lua` consulta primero `idem:{clave}`: si existe devuelve el
   recibo original (`ALREADY_REGISTERED`, mismo `receiptId`) y no suma nada.

**¿Y si el servidor cae entre registrar y confirmar?** El script es atómico: o se aplicó
todo (acumulados, eventos y recibo en `idem:*`) o nada. Si se aplicó y la respuesta se
perdió, el jurado no vio confirmación y reintenta con la misma clave → recibe
`ALREADY_REGISTERED` con el recibo original. Si no se aplicó, el reintento lo aplica. En
ningún caso se suma dos veces ni se pierde el acta. Si Redis no responde, el servidor
contesta **503 `NOT_REGISTERED`** (nunca 200 sin haber escrito) y la app muestra
*"No registrada. Está guardada en tu teléfono y se enviará sola"*.

**¿Y si la clave de idempotencia expira (24 h) antes del reintento?** Hay una segunda
barrera independiente de la clave: el estado del acta (`acta:{id}`) guarda la versión
máxima y el hash del contenido.

| Llega… | Respuesta | Efecto |
|---|---|---|
| misma versión, mismo hash | `ALREADY_REGISTERED` (recibo original) | ninguno |
| misma versión, otro contenido | `CONFLICT` | el acta deja de sumar y va a verificación |
| versión menor | `OBSOLETE` | ninguno |

Prueba: *"still answers ALREADY_REGISTERED without adding when the idempotency key expired"*.

## 2. Convergencia sin importar el orden (RF-2)

Regla: **el estado de un acta es su versión máxima recibida**. Si es válida, es la que
suma; si es dudosa (no cuadra la regla contable, más sufragantes que habilitados, o
conflicto), el acta aporta 0 hasta que un auditor la resuelva; las versiones menores son
`OBSOLETE`. Como el resultado es función del **conjunto** de versiones (la máxima de cada
acta) y de las decisiones de auditoría, el orden de llegada no importa.

Una corrección resta la versión aplicada y suma la nueva **en el mismo paso** (deltas
netos), y emite un evento `CORRECTION`; si la nueva versión es dudosa, el valor publicado
se revierte con un evento `REVERSAL` y motivo `UNDER_REVIEW`. Así, un número público nunca
cambia sin explicación.

Prueba: versiones 1, 2 y 3 (algunas dudosas) de 12 actas entregadas en 10 órdenes
aleatorios producen exactamente los mismos acumulados de departamento, municipios y puestos.

## 3. Acumulados jerárquicos atómicos: por qué Lua y no comandos seguidos (RF-3)

Cada acta actualiza 4 niveles (mesa, puesto, municipio, departamento), 3 rankings
(`ZINCRBY`), las mesas informadas, el registro del acta, dos *streams* y, si aplica, la
cola de verificación. Con comandos sueltos desde Node:

- **Lecturas inconsistentes:** otra instancia (o el *snapshot* público) podría leer entre
  dos comandos y ver el municipio actualizado con su puesto sin actualizar.
- **Fallos a mitad:** si la instancia muere tras el tercer `HINCRBY`, los niveles quedan
  descuadrados para siempre.
- **Carreras:** "leer versión → decidir → escribir" desde dos instancias a la vez puede
  aplicar dos versiones. `MULTI/EXEC` no ayuda: no permite decidir con lo leído dentro de
  la transacción (y `WATCH` obliga a reintentar bajo contención).

Redis ejecuta un script Lua **sin intercalar ningún otro comando**: la comparación de
versión, la reversión, la suma en los 4 niveles y el `XADD` ocurren como un solo paso
indivisible. Restricciones que respetamos: el script es corto (bloquea Redis mientras
corre, así que solo hace un número fijo de operaciones por campo; su duración se registra
en la métrica `actas_lua_ms`), declara todas sus claves en `KEYS` (en Redis Cluster deberían estar
en el mismo *slot*, con un *hash tag*; aquí hay un solo nodo) y no hace E/S externa:
Supabase se actualiza después, desde el *stream* `ev:actas` con un *consumer group*.

Prueba: tras 500 actas aleatorias (con correcciones y dudosas),
`tot:dep` = Σ `tot:mun:*` = Σ `tot:station:*` campo por campo, y el ranking coincide con
los totales.

## 4. Persistencia fuera del camino crítico

Cada instancia es consumidora del grupo `persist` sobre `ev:actas`: cada evento lo procesa
**una** instancia, se confirma (`XACK`) solo cuando Supabase lo aceptó y `XAUTOCLAIM`
recupera los pendientes de una instancia caída. Si Supabase cae, la ingesta sigue
funcionando y el histórico se pone al día después.
