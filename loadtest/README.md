# Pruebas de carga (RT-8, RF-9, RF-10)

Todo se ejecuta **desde otra máquina**, nunca desde el servidor que se mide. Requisitos: Node 22+ y `pnpm install` en la raíz (solo `jornada.ts` usa dependencias).

```bash
ulimit -n 200000          # Linux/macOS: muchos sockets abiertos
```

Antes de una prueba grande, en el servidor sube el límite de aperturas del stream público por IP (todas las conexiones salen de la misma IP) y reinicia:

```bash
echo "PUBLICO_LIMITE_POR_MIN=100000" >> ~/preconteo/.env
docker compose -f infra/docker-compose.yml up -d
```

Y vuelve a quitarlo al terminar (el valor normal es 30).

## 1. Público masivo (RT-8)

```bash
node loadtest/publico.mjs --url https://HOST --conexiones 1000 --procesos 4      # calentamiento
node loadtest/publico.mjs --url https://HOST --conexiones 20000 --procesos 8     # objetivo del caso
```

Imprime cada segundo: conexiones abiertas, reconexiones, deltas recibidos y latencia p50/p99 (recepción del acta → entrega al navegador). Mientras corre, `/ops` muestra conexiones por instancia, mensajes/s y retraso del Event Loop.

Una sola máquina abre ~28.000 conexiones hacia un mismo destino (puertos efímeros); para más, repartir entre 2 máquinas.

## 2. Jornada electoral (perfil del caso)

```bash
JWT_SECRET=<el del servidor> pnpm exec tsx loadtest/jornada.ts --url https://HOST --acelerar 20
```

6.400 actas con 55 % en los primeros 40 min, 4–11 % de reenvíos (misma clave de idempotencia), ~180 correcciones y 6–9 % de dudosas. `--acelerar 20` comprime las 2 h en 6 min. Al final imprime cuántos recibos hubo de cada tipo (`REGISTERED`, `ALREADY_REGISTERED`, `UNDER_REVIEW`, `OBSOLETE`…): los reenvíos nunca suman dos veces.

Corriendo `publico.mjs` y `jornada.ts` a la vez se obtiene la cifra **mensajes reales vs. ingenuos** en `/ops`.

## 3. Avalancha de reconexión (RF-10) — gráfica con y sin jitter

```bash
node loadtest/publico.mjs --url https://HOST --conexiones 5000 --jitter on  --csv con-jitter.csv
# cuando estén conectados, en el servidor:  docker stop preconteo-app3-1
# esperar ~40 s, Ctrl+C, docker start preconteo-app3-1

node loadtest/publico.mjs --url https://HOST --conexiones 5000 --jitter off --csv sin-jitter.csv
# repetir lo mismo
```

Cada CSV tiene una fila por segundo con `intentos_por_s` y `reconexiones_por_s`. Sin jitter se ve un pico enorme (todos reintentan a la vez cada segundo); con jitter el mismo número de clientes vuelve repartido en varios segundos. Graficar ambas columnas en una hoja de cálculo para el informe.

## 4. Cliente lento (RF-9)

```bash
node loadtest/lento.mjs --url https://HOST --conexiones 20 --bytes-por-seg 0
```

Abre streams y no lee. Con tráfico (correr `jornada.ts` a la vez) el servidor deja de mandarle deltas al pasar 64 KB pendientes y lo desconecta con `event: reconectar` al pasar 512 KB o 30 s de atraso. La política también está probada en `apps/web/test/publico/difusion.test.js`.

## 5. INP (RT-9)

Abrir `/resultados` en un teléfono de gama baja (o Chrome DevTools → *Performance* → CPU 6× más lenta) mientras corre la carga e interactuar con los selectores. El p75 del INP medido en los navegadores aparece en `/ops`.
