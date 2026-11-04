/**
 * Prueba de humo de la "Definición de terminado" (RF-7/RF-8) contra instancias reales:
 * dos auditores conectados a instancias DISTINTAS ven en vivo cuando el otro toma un caso,
 * el coordinador los ve en presencia y el reaper devuelve el caso si nadie lo renueva.
 *
 * Uso (con las instancias y Redis levantados):
 *   JWT_SECRET=... REDIS_URL=redis://localhost:6379 \
 *   URL_A=http://localhost:3001 URL_B=http://localhost:3002 node scripts/smoke-dos-instancias.js
 */
import { Redis } from 'ioredis';
import WebSocket from 'ws';
import { TokenService } from '../src/server/core/auth/TokenService.js';
import { COOKIE_SESION } from '../src/server/core/auth/credenciales.js';
import {
  encolarCasoFalso,
  casoDeEjemplo,
} from '../src/server/modules/verificacion/dev/casosFalsos.js';

const URL_A = process.env.URL_A ?? 'http://localhost:3001';
const URL_B = process.env.URL_B ?? 'http://localhost:3002';
const tokens = new TokenService({ secreto: process.env.JWT_SECRET });
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

async function conectar(urlBase, usuario) {
  const jwt = await tokens.firmar(usuario);
  return new Promise((resolver, rechazar) => {
    const ws = new WebSocket(`${urlBase.replace('http', 'ws')}/ws/verificacion`, {
      headers: { Cookie: `${COOKIE_SESION}=${jwt}` },
    });
    const recibidos = [];
    ws.on('upgrade', (res) => (ws.instancia = res.headers['x-instance']));
    ws.on('message', (d) => recibidos.push(JSON.parse(d.toString())));
    ws.on('open', () => resolver(Object.assign(ws, { recibidos })));
    ws.on('unexpected-response', (_req, res) =>
      rechazar(new Error(`upgrade rechazado ${res.statusCode}`)),
    );
  });
}

const esperar = async (ws, predicado, ms = 3_000) => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const m = ws.recibidos.find(predicado);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('No llegó el mensaje esperado');
};

const ok = (texto) => console.log(`  ✓ ${texto}`);

async function main() {
  const caso = await encolarCasoFalso(redis, casoDeEjemplo(Math.floor(Math.random() * 90_000)));

  // Un JURADO no puede abrir la consola: rechazo ANTES del upgrade.
  await conectar(URL_A, { sub: 'j1', rol: 'JURADO', nombre: 'Jurado' }).then(
    () => {
      throw new Error('el jurado no debía conectar');
    },
    (e) => ok(`jurado rechazado en el upgrade (${e.message})`),
  );

  const ana = await conectar(URL_A, { sub: 'ana', rol: 'AUDITOR', nombre: 'Ana' });
  const beto = await conectar(URL_B, { sub: 'beto', rol: 'AUDITOR', nombre: 'Beto' });
  const coord = await conectar(URL_B, { sub: 'carla', rol: 'COORDINADOR', nombre: 'Carla' });
  ok(`Ana en ${ana.instancia}, Beto en ${beto.instancia}, Carla (coord.) en ${coord.instancia}`);

  await esperar(beto, (m) => m.tipo === 'estado_cola' && m.items.some((i) => i.acta === caso.acta));
  ok('estado_cola inicial incluye el caso');

  ana.send(JSON.stringify({ tipo: 'tomar', acta: caso.acta }));
  const tomado = await esperar(ana, (m) => m.tipo === 'tomado_ok');
  await esperar(beto, (m) => m.tipo === 'caso_tomado' && m.acta === caso.acta);
  ok(
    `Ana tomó ${caso.acta} (fencing ${tomado.fencing}) y Beto lo vio al instante desde otra instancia`,
  );

  beto.send(JSON.stringify({ tipo: 'tomar', acta: caso.acta }));
  await esperar(beto, (m) => m.tipo === 'error' && m.codigo === 'YA_TOMADO');
  ok('Beto no puede tomarlo: YA_TOMADO');

  ana.send(
    JSON.stringify({
      tipo: 'latido',
      actividad: Date.now(),
      inactivoMs: 0,
      acta: caso.acta,
      token: tomado.token,
    }),
  );
  beto.send(JSON.stringify({ tipo: 'latido', actividad: Date.now(), inactivoMs: 0 }));
  await esperar(ana, (m) => m.tipo === 'lock_renovado');
  ok('latido con actividad renueva el lease');
  const presencia = await esperar(
    coord,
    (m) =>
      m.tipo === 'presencia' &&
      m.lista.some((p) => p.sub === 'ana' && p.caso === caso.acta) &&
      m.lista.some((p) => p.sub === 'beto'),
    7_000,
  );
  ok(
    `coordinador ve presencia: ${presencia.lista.map((p) => `${p.nombre}@${p.instancia}`).join(', ')}`,
  );

  ana.terminate(); // cierre abrupto: sin latidos, el lease expira y el reaper lo devuelve
  await esperar(beto, (m) => m.tipo === 'caso_liberado' && m.acta === caso.acta, 40_000);
  ok('Ana desapareció sin avisar → el caso volvió solo a la cola (≤ 30 s + reaper)');

  beto.close();
  coord.close();
  await redis.quit();
  console.log('\nTodo OK');
}

main().catch(async (err) => {
  console.error('FALLÓ:', err.message);
  await redis.quit();
  process.exit(1);
});
