#!/usr/bin/env node
/**
 * Cliente deliberadamente lento (RF-9): abre streams públicos y NO lee la respuesta
 * (o la lee muy despacio), para que el búfer de salida del servidor crezca.
 *
 *   node loadtest/lento.mjs --url https://HOST --conexiones 20 --bytes-por-seg 0
 *
 * Lo esperado (política del servidor):
 * - al pasar 64 KB pendientes deja de recibir deltas (métrica publico_clientes_atrasados en /ops);
 * - si se pone al día recibe `event: snapshot`;
 * - si pasa 512 KB o 30 s atrasado, el servidor cierra con `event: reconectar`.
 * Como cada delta pesa ~300 B, conviene correrlo junto con `jornada.ts --acelerar 20`
 * y suscrito a muchos tópicos para llenar los búferes en minutos.
 */
import http from 'node:http';
import https from 'node:https';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    conexiones: { type: 'string', default: '10' },
    'bytes-por-seg': { type: 'string', default: '0' },
  },
});

const base = new URL(values.url);
const cliente = base.protocol === 'https:' ? https : http;
const ritmo = Number(values['bytes-por-seg']);
const inicio = Date.now();
const seg = () => ((Date.now() - inicio) / 1000).toFixed(0);

for (let i = 0; i < Number(values.conexiones); i++) {
  const topicos = ['dep', `mun:${1 + (i % 30)}`, `station:${1 + i}`].join(',');
  cliente.get(new URL(`/api/publico/stream?topics=${topicos}`, base), { headers: { Accept: 'text/event-stream' } }, (res) => {
    console.log(`[${seg()}s] cliente ${i}: conectado (${res.statusCode}, ${res.headers['x-instance']})`);
    let leidos = 0;
    res.on('data', (trozo) => {
      leidos += trozo.length;
      const texto = trozo.toString();
      if (texto.includes('event: snapshot') && leidos > 2_000) console.log(`[${seg()}s] cliente ${i}: recibió fotografía tras ponerse al día`);
      if (texto.includes('event: reconectar')) console.log(`[${seg()}s] cliente ${i}: el servidor pidió reconectar (cliente lento)`);
      res.pause();
      if (ritmo > 0) setTimeout(() => res.resume(), (trozo.length / ritmo) * 1000);
    });
    res.on('close', () => console.log(`[${seg()}s] cliente ${i}: conexión cerrada por el servidor (leídos ${leidos} B)`));
    if (ritmo === 0) res.pause(); // no lee nada
  });
}
