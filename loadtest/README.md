# Pruebas de carga de Evelyn

Requisitos: Node 22+, pnpm, Redis 7, servidor local/desplegado y JWT_SECRET para jornada.

```bash
ulimit -n 200000
pnpm exec tsx scripts/fake-events.ts
# ráfaga de hasta 300 eventos
kill -USR2 <PID_DEL_PROCESO>

# empezar pequeño y aumentar
pnpm exec tsx loadtest/publico.ts --url http://localhost:3000/api/publico/stream --conexiones 100 --procesos 4
pnpm exec tsx loadtest/publico.ts --url http://localhost:3000/api/publico/stream --conexiones 20000 --procesos 8
pnpm exec tsx loadtest/lento.ts
JWT_SECRET=... pnpm exec tsx loadtest/jornada.ts --acelerar 10

# Avalancha: ejecutar en una terminal y detener app3 en otra cuando conecte
pnpm exec tsx loadtest/avalancha.ts --clientes 1000 --jitter on --salida jitter-on.csv
pnpm exec tsx loadtest/avalancha.ts --clientes 1000 --jitter off --salida jitter-off.csv
docker stop app3
```

El cliente de avalancha exporta marcas temporales del ensayo; para medir reconexiones/s hay que agregar al CSV el contador de eventos `open` reportado por cada worker o instrumentar el balanceador. La comparación debe repetirse con la misma carga y entorno.

No ejecutar 20k/50k sockets en un portátil: usar una VM dedicada, límites de archivos/puertos adecuados y, si hace falta, varias máquinas generadoras.
