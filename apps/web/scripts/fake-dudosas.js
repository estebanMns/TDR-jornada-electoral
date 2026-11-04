/**
 * Encola actas dudosas falsas con el mismo formato que usará el módulo de actas
 * (`verif:queue` + `verif:case:{acta}`) y avisa por `ch:verif`. Permite trabajar
 * en la consola de verificación sin esperar a Jose (GENERAL §10, regla 5).
 *
 *   pnpm fake:dudosas            → 25 casos
 *   pnpm fake:dudosas 100        → 100 casos
 *   CADA_MS=3000 pnpm fake:dudosas 50   → uno cada 3 s (ver llegar `caso_nuevo` en vivo)
 */
import { Redis } from 'ioredis';
import {
  encolarCasoFalso,
  casoDeEjemplo,
} from '../src/server/modules/verificacion/dev/casosFalsos.js';

const cantidad = Number(process.argv[2] ?? 25);
const cadaMs = Number(process.env.CADA_MS ?? 0);
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  password: process.env.REDIS_PASSWORD || undefined,
});

const inicio = Math.floor(Math.random() * 50_000);
for (let i = 0; i < cantidad; i += 1) {
  const caso = await encolarCasoFalso(redis, casoDeEjemplo(inicio + i));
  console.log(`encolado ${caso.acta} (prioridad ${caso.prioridad}, ${caso.motivo})`);
  if (cadaMs > 0) await new Promise((r) => setTimeout(r, cadaMs));
}
await redis.quit();
