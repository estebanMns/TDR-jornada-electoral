#!/usr/bin/env node
/**
 * Clientes públicos masivos por SSE (RT-8) y avalancha de reconexión (RF-10).
 *
 *   node loadtest/publico.mjs --url https://HOST --conexiones 20000 --procesos 8
 *   node loadtest/publico.mjs --url https://HOST --conexiones 5000 --jitter off --csv sin-jitter.csv
 *
 * Cada cliente se suscribe a un tópico (60 % departamento, 35 % municipio, 5 % puesto),
 * cuenta los deltas que recibe y mide la latencia recepción → entrega (`tsRx`).
 * Si la conexión se cae, reconecta enviando su `Last-Event-ID`:
 *   --jitter on  → espera aleatoria entre 0 y min(30 s, 0,5 s · 2^intento)  (lo que hace la app)
 *   --jitter off → espera fija de 1 s para todos                             (cliente ingenuo)
 * Con --csv se guarda una fila por segundo (intentos/s, reconexiones/s…) para graficar.
 *
 * Sin dependencias: solo Node 22+. Sube el límite de archivos antes: `ulimit -n 200000`.
 */
import http from 'node:http';
import https from 'node:https';
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opciones } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    conexiones: { type: 'string', default: '1000' },
    procesos: { type: 'string', default: '4' },
    jitter: { type: 'string', default: 'on' },
    rampa: { type: 'string', default: '500' }, // aperturas por segundo y proceso al inicio
    csv: { type: 'string' },
  },
});

if (process.env.WORKER) trabajador();
else coordinador();

// ------------------------------------------------------------------ coordinador

function coordinador() {
  const total = Number(opciones.conexiones);
  const procesos = Number(opciones.procesos);
  const porSegundo = new Map(); // segundo → suma de todos los procesos
  const abiertasPorProceso = new Map(); // nivel actual de conexiones abiertas de cada proceso
  const inicio = Date.now();
  console.log(`→ ${total} conexiones en ${procesos} procesos contra ${opciones.url} (jitter ${opciones.jitter})`);

  for (let i = 0; i < procesos; i++) {
    const cantidad = Math.floor(total / procesos) + (i < total % procesos ? 1 : 0);
    const hijo = fork(new URL(import.meta.url), process.argv.slice(2), {
      env: { ...process.env, WORKER: String(i), CANTIDAD: String(cantidad) },
    });
    hijo.on('message', (m) => {
      const s = Math.floor((m.ts - inicio) / 1000);
      const fila = porSegundo.get(s) ?? { abiertas: 0, intentos: 0, reconexiones: 0, eventos: 0, errores: 0, lat: [] };
      abiertasPorProceso.set(i, m.abiertas);
      fila.abiertas = [...abiertasPorProceso.values()].reduce((a, b) => a + b, 0);
      fila.intentos += m.intentos;
      fila.reconexiones += m.reconexiones;
      fila.eventos += m.eventos;
      fila.errores += m.errores;
      fila.lat.push(...m.lat);
      porSegundo.set(s, fila);
    });
  }

  const informe = setInterval(() => {
    const s = Math.floor((Date.now() - inicio) / 1000) - 1;
    const f = porSegundo.get(s);
    if (!f) return;
    const lat = f.lat.sort((a, b) => a - b);
    const p = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : '-');
    console.log(
      `t=${String(s).padStart(4)}s abiertas=${f.abiertas} intentos/s=${f.intentos} reconexiones/s=${f.reconexiones} ` +
        `deltas/s=${f.eventos} latencia p50=${p(0.5)}ms p99=${p(0.99)}ms errores=${f.errores}`,
    );
  }, 1000);

  const terminar = () => {
    clearInterval(informe);
    if (opciones.csv) {
      const filas = ['segundo,abiertas,intentos_por_s,reconexiones_por_s,deltas_por_s,errores'];
      for (const [s, f] of [...porSegundo].sort((a, b) => a[0] - b[0])) {
        filas.push([s, f.abiertas, f.intentos, f.reconexiones, f.eventos, f.errores].join(','));
      }
      writeFileSync(opciones.csv, `${filas.join('\n')}\n`);
      console.log(`CSV guardado en ${opciones.csv}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', terminar);
  process.on('SIGTERM', terminar);
}

// ------------------------------------------------------------------ trabajador

function trabajador() {
  const base = new URL(opciones.url);
  const cliente = base.protocol === 'https:' ? https : http;
  const agente = new cliente.Agent({ keepAlive: false, maxSockets: Infinity });
  const conJitter = opciones.jitter !== 'off';
  const cantidad = Number(process.env.CANTIDAD);
  const rampa = Number(opciones.rampa);
  const stats = { abiertas: 0, intentos: 0, reconexiones: 0, eventos: 0, errores: 0, lat: [] };

  const topicoAleatorio = () => {
    const r = Math.random();
    if (r < 0.6) return 'dep';
    if (r < 0.95) return `mun:${1 + Math.floor(Math.random() * 30)}`;
    return `station:${1 + Math.floor(Math.random() * 1842)}`;
  };

  const espera = (intento) =>
    conJitter ? Math.floor(Math.random() * Math.min(30_000, 500 * 2 ** intento)) : 1_000;

  function abrir(c) {
    stats.intentos += 1;
    if (c.ultimoId) stats.reconexiones += 1;
    const url = new URL(`/api/publico/stream?topics=${c.topico}`, base);
    const headers = { Accept: 'text/event-stream' };
    if (c.ultimoId) headers['Last-Event-ID'] = c.ultimoId;
    const req = cliente.get(url, { agent: agente, headers }, (res) => {
      if (res.statusCode !== 200) {
        stats.errores += 1;
        res.resume();
        return reintentar(c);
      }
      c.abierta = true;
      c.intento = 0;
      stats.abiertas += 1;
      let resto = '';
      res.setEncoding('utf8');
      res.on('data', (trozo) => {
        resto += trozo;
        let fin;
        while ((fin = resto.indexOf('\n\n')) >= 0) {
          const bloque = resto.slice(0, fin);
          resto = resto.slice(fin + 2);
          const id = /^id: (.+)$/m.exec(bloque)?.[1];
          if (id) c.ultimoId = id;
          if (bloque.includes('event: delta')) {
            stats.eventos += 1;
            const tsRx = /"tsRx":(\d+)/.exec(bloque)?.[1];
            if (tsRx && stats.lat.length < 200) stats.lat.push(Date.now() - Number(tsRx));
          }
        }
      });
      res.on('close', () => {
        if (c.abierta) stats.abiertas -= 1;
        c.abierta = false;
        reintentar(c);
      });
    });
    req.on('error', () => {
      stats.errores += 1;
      reintentar(c);
    });
  }

  function reintentar(c) {
    if (c.pendiente) return;
    c.pendiente = true;
    setTimeout(() => {
      c.pendiente = false;
      c.intento += 1;
      abrir(c);
    }, espera(c.intento));
  }

  // Rampa de subida: `rampa` aperturas por segundo para no provocar una avalancha propia.
  let creadas = 0;
  const subir = setInterval(() => {
    for (let i = 0; i < rampa / 10 && creadas < cantidad; i++, creadas++) {
      abrir({ topico: topicoAleatorio(), ultimoId: null, intento: 0, abierta: false, pendiente: false });
    }
    if (creadas >= cantidad) clearInterval(subir);
  }, 100);

  setInterval(() => {
    process.send({ ts: Date.now(), ...stats });
    stats.intentos = 0;
    stats.reconexiones = 0;
    stats.eventos = 0;
    stats.errores = 0;
    stats.lat = []; // `abiertas` es un nivel (no se reinicia); el resto son contadores por segundo
  }, 1_000);
}
