import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PublicoRepository } from './publico.repository.js';
import { PublicoService } from './publico.service.js';
import { SseConnection } from '../../core/transport/SseConnection.js';

const dir = dirname(fileURLToPath(import.meta.url));
const lua = await readFile(join(dir, 'lua/snapshot.lua'), 'utf8');

export const moduloPublico = {
  nombre: 'publico',
  registrar(p) {
    p.redis.definirScripts([{ nombre: 'snapshotPublico', numeroClaves: 3, lua }]);
    const reader = p.redis.crearConexionBloqueante('publico-xread');
    const repository = new PublicoRepository({ redis: p.redis, reader });
    const service = new PublicoService({ repository, logger: p.logger, metrics: p.metrics });
    p.redis.on('cambioEstado', (nuevo) => service.redisStateChanged(nuevo));
    service.start();

    p.router.http('/api/publico/stream', async (req, res, url) => {
      const topics = [...new Set((url.searchParams.get('topics') ?? 'dep').split(',').map(x => x.trim()).filter(Boolean))];
      if (!topics.length || topics.length > 3 || topics.some(t => !/^(dep|mun:\d+|station:\d+)$/.test(t))) {
        res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'topics inválidos; máximo 3' }));
      }
      const ip = req.socket.remoteAddress ?? 'unknown';
      const rate = await p.limitador.consumir({ clave: `publico:${ip}`, limite: 30, ventanaSeg: 60 });
      if (!rate.permitido) {
        res.writeHead(429, { 'Retry-After': String(rate.reintentarEn) }); return res.end();
      }
      const lastId = req.headers['last-event-id'] ?? url.searchParams.get('lastEventId');
      const conn = p.conexiones.agregar(new SseConnection(res, { retryMs: 500 + Math.floor(Math.random() * 2500) }));
      service.subscribe(topics, conn);
      for (const topic of topics) await service.enviarInicial(conn, topic, lastId);
      const ping = setInterval(() => conn.comentario('ping'), 25_000);
      conn.onClose(() => clearInterval(ping));
    });

    p.router.http('/api/publico/snapshot', async (_req, res, url) => {
      const topic = url.searchParams.get('topic') ?? 'dep';
      if (!/^(dep|mun:\d+|station:\d+)$/.test(topic)) { res.writeHead(400); return res.end(); }
      const data = await repository.snapshot(topic);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    });

    p.router.http('/api/vitals', async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400); return res.end(); }
      if (body.name !== 'INP' || !Number.isFinite(Number(body.value))) { res.writeHead(400); return res.end(); }
      await repository.guardarInp(Number(body.value));
      res.writeHead(204); res.end();
    });

    p.contenedor.registrar('publicoService', service);
  },
};
