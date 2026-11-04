/**
 * Simula la transmisión de la jornada (RT-8) con el perfil del caso:
 * - 6.400 mesas; 55 % de las actas en los primeros 40 min, el resto hasta las 2 h.
 * - 4–11 % de reenvíos del mismo envío (misma clave de idempotencia).
 * - ~180 correcciones (versión 2) y 6–9 % de actas dudosas (no cuadran).
 *
 *   JWT_SECRET=... pnpm exec tsx loadtest/jornada.ts --url https://HOST --acelerar 20
 *
 * `--acelerar 20` comprime las 2 h en 6 min. Firma tokens de jurado con el JWT_SECRET
 * del servidor (SOLO para el entorno de pruebas).
 */
import { createHmac, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { setTimeout as dormir } from 'node:timers/promises';
import { CANDIDATE_IDS, VOTE_OPTION_IDS, type ActaSubmission, type Catalog, type Votes } from '@preconteo/contracts';
import catalogJson from '../packages/contracts/catalog.json' with { type: 'json' };
import { devJurorPayload, devSecret, signDevToken } from '../scripts/lib/devToken';

const catalogo = catalogJson as Catalog;
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    acelerar: { type: 'string', default: '1' },
    mesas: { type: 'string', default: String(catalogo.tables.length) },
    concurrencia: { type: 'string', default: '50' },
  },
});

const ACELERAR = Math.max(1, Number(values.acelerar));
const VENTANA_MS = (2 * 60 * 60_000) / ACELERAR;
const PICO_MS = (40 * 60_000) / ACELERAR;
const mesas = catalogo.tables.slice(0, Number(values.mesas));
const secreto = devSecret();

function votosAleatorios(sufragantes: number): Votes {
  const votos = Object.fromEntries(VOTE_OPTION_IDS.map((o) => [o, 0])) as Votes;
  for (let i = 0; i < sufragantes; i++) {
    const r = Math.random();
    const opcion =
      r < 0.93 ? CANDIDATE_IDS[Math.floor(Math.random() * CANDIDATE_IDS.length)]! : (['BLANK', 'NULL', 'UNMARKED'] as const)[Math.floor(Math.random() * 3)]!;
    votos[opcion] += 1;
  }
  return votos;
}

type Envio = { at: number; mesa: (typeof mesas)[number]; version: number };
const plan: Envio[] = mesas.map((mesa, i) => ({
  mesa,
  version: 1,
  at: i < mesas.length * 0.55 ? Math.random() * PICO_MS : PICO_MS + Math.random() * (VENTANA_MS - PICO_MS),
}));
// ~180 correcciones (versión 2) sobre actas distintas ya enviadas
const corregidas = new Set<number>();
while (corregidas.size < Math.round((180 * mesas.length) / 6400)) corregidas.add(Math.floor(Math.random() * mesas.length));
for (const i of corregidas) {
  const original = plan[i]!;
  plan.push({ mesa: original.mesa, version: 2, at: Math.min(VENTANA_MS, original.at + Math.random() * PICO_MS) });
}
plan.sort((a, b) => a.at - b.at);

const tasaReenvio = 0.04 + Math.random() * 0.07;
const tasaDudosa = 0.06 + Math.random() * 0.03;
const resultados: Record<string, number> = {};
let enviados = 0;
let enVuelo = 0;
const inicio = Date.now();

async function enviar({ mesa, version }: Envio): Promise<void> {
  const token = signDevToken(devJurorPayload(mesa.id), secreto);
  const sufragantes = Math.floor(mesa.enabled * (0.5 + Math.random() * 0.4));
  const cuerpo: ActaSubmission = {
    actaId: mesa.actaId,
    version,
    tableId: mesa.id,
    votes: votosAleatorios(sufragantes),
    voters: Math.random() < tasaDudosa ? sufragantes + 3 : sufragantes,
    photoHash: createHmac('sha256', 'foto').update(`${mesa.actaId}-${version}`).digest('hex'),
  };
  const clave = randomUUID();
  const veces = Math.random() < tasaReenvio ? 2 + Math.floor(Math.random() * 3) : 1;
  for (let i = 0; i < veces; i++) {
    try {
      const res = await fetch(new URL('/api/actas', values.url), {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': clave },
        body: JSON.stringify(cuerpo),
      });
      const recibo = (await res.json().catch(() => ({}))) as { result?: string };
      const clave2 = recibo.result ?? `HTTP_${res.status}`;
      resultados[clave2] = (resultados[clave2] ?? 0) + 1;
    } catch {
      resultados.ERROR_RED = (resultados.ERROR_RED ?? 0) + 1;
    }
  }
}

const informe = setInterval(() => {
  const min = ((Date.now() - inicio) / 60_000).toFixed(1);
  console.log(`t=${min} min  enviados=${enviados}/${plan.length}  en vuelo=${enVuelo}  ${JSON.stringify(resultados)}`);
}, 5_000);

console.log(`→ ${plan.length} envíos en ${(VENTANA_MS / 60_000).toFixed(1)} min (reenvíos ${(tasaReenvio * 100).toFixed(1)} %, dudosas ${(tasaDudosa * 100).toFixed(1)} %)`);
for (const envio of plan) {
  const espera = inicio + envio.at - Date.now();
  if (espera > 0) await dormir(espera);
  while (enVuelo >= Number(values.concurrencia)) await dormir(5);
  enVuelo += 1;
  enviados += 1;
  void enviar(envio).finally(() => (enVuelo -= 1));
}
while (enVuelo > 0) await dormir(50);
clearInterval(informe);
console.log('Jornada terminada:', resultados);
