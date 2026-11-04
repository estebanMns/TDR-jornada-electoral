# Entrega Evelyn — Público en tiempo real

Esta entrega sigue `docs/tareas/evelyn.md` y los contratos de `docs/GENERAL.md` consultados en la rama `feat/evelin-fan-out`.

## Estructura del repositorio consultado
La rama existente usa JavaScript/Next en `apps/web/src/server` (no tiene `apps/server`), `packages/shared/catalog.json`, `SseConnection`, `ClientConnection`, `RedisGateway`, `RateLimiter` y `RealtimeRouter`. Por eso se respeta la estructura real:
- Backend: `apps/web/src/server/modules/publico/`
- UI: `apps/web/src/features/{publico,ops}/`
- Componentes y red: `apps/web/src/shared/{ui,net}/`
- Rutas Next: `apps/web/src/app/{resultados,ops}/`
- Carga: `loadtest/` y `scripts/fake-events.ts`

## Instalación
Copia el contenido conservando rutas relativas en la raíz del repositorio. Luego:
1. En `apps/web/src/server/app.js`, importa `moduloPublico` y añádelo a `MODULOS`.
2. Instala `web-vitals` en `apps/web` si aún no está: `pnpm --filter @preconteo/web add web-vitals`.
3. Verifica que `packages/shared/catalog.json` contiene `municipalities`, `stations`, `tables` y `voteOptions` (en esta rama sí existe).
4. Ejecuta `pnpm test`, `pnpm --filter @preconteo/web build`.
5. Levanta Redis y servidor; ejecuta los comandos de `loadtest/README.md`.

## Contrato de eventos ev:all
Cada entrada del stream contiene pares:
`topic`, `abs` (JSON con votos absolutos por opción), `motivos` (JSON array de razones/correcciones), `ts_rx` (epoch ms).
Los acumulados se fusionan por última escritura; los clientes reciben `event: delta` con `abs`, `motivos`, `ts_rx` y `hastaId`.

## Nota de validación
El código se ha ajustado a los contratos reales leídos del repositorio, pero no se ha ejecutado contra una instancia Redis ni contra el entorno de despliegue. No se debe afirmar que las pruebas de 20k/50k sockets se ejecutaron; los scripts permiten ejecutarlas en un host dimensionado.
