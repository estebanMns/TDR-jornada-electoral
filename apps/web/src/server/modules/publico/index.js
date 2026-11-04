import { fileURLToPath } from 'node:url';
import { cargarScriptsLua } from '../../core/redis/cargarScriptsLua.js';
import { SseConnection } from '../../core/transport/SseConnection.js';
import { TareaPeriodica } from '../../core/tasks/TareaPeriodica.js';
import { ipCliente } from '../../core/auth/credenciales.js';
import { PublicoRepository } from './publico.repository.js';
import { PublicoService } from './publico.service.js';
import { BackpressurePolicy } from './backpressure-policy.js';
import { esTopicoValido } from './eventos.js';

const DIRECTORIO_LUA = fileURLToPath(new URL('./lua/', import.meta.url));
const MAX_TOPICOS = 3;
const MAX_CUERPO_VITALS = 2_048;

/**
 * Difusión pública en tiempo real (RF-4, RF-5, RF-6, RF-9, RT-9). Dueña: Evelyn.
 *
 * - `GET  /api/publico/stream?topics=dep,mun:11`  SSE (Last-Event-ID o ?lastEventId=)
 * - `GET  /api/publico/snapshot?topic=mun:11`     fotografía JSON
 * - `POST /api/vitals`                            muestras de INP de la página pública
 * @type {import('../../core/Plataforma.js').Modulo}
 */
export const moduloPublico = {
  nombre: 'publico',

  registrar(p) {
    p.redis.definirScripts(
      cargarScriptsLua(DIRECTORIO_LUA, { snapshotPublico: { archivo: 'snapshot.lua', numeroClaves: 3 } }),
    );
    const repositorio = new PublicoRepository({
      redis: p.redis,
      lector: p.redis.crearConexionBloqueante('publico-xread'),
    });
    const servicio = new PublicoService({
      repositorio,
      politica: new BackpressurePolicy({ metrics: p.metrics }),
      metrics: p.metrics,
      logger: p.logger,
      ventanaMs: p.config.difusion.ventanaMs,
    });
    p.redis.on('cambioEstado', (nuevo) => servicio.cambioDeRedis(nuevo));
    p.tareas.agregar({
      nombre: 'publico-difusion',
      iniciar: () => servicio.iniciar(),
      detener: () => void servicio.detener(),
    });
    p.tareas.agregar(
      new TareaPeriodica({ nombre: 'publico-ping', intervaloMs: 25_000, logger: p.logger, ejecutar: () => servicio.ping() }),
    );

    let inpP75 = null;
    p.metrics.gauge('inp_p75_ms', () => inpP75);
    p.tareas.agregar(
      new TareaPeriodica({
        nombre: 'publico-inp',
        intervaloMs: 10_000,
        logger: p.logger,
        ejecutar: async () => {
          if (p.redis.disponible()) inpP75 = await repositorio.inpP75();
        },
      }),
    );

    p.router.http('/api/publico/stream', async (req, res, url) => {
      const topicos = [
        ...new Set((url.searchParams.get('topics') ?? 'dep').split(',').map((t) => t.trim()).filter(Boolean)),
      ];
      if (topicos.length === 0 || topicos.length > MAX_TOPICOS || !topicos.every(esTopicoValido)) {
        return responderJson(res, 400, { error: 'TOPICOS_INVALIDOS', maximo: MAX_TOPICOS });
      }
      // Con Redis caído no hay contador compartido: se deja entrar y verá "pausado".
      if (p.redis.disponible()) {
        const { permitido, reintentarEn } = await p.limitador.consumir({
          clave: `publico:${ipCliente(req.headers)}`,
          limite: p.config.difusion.limitePorMinuto,
          ventanaSeg: 60,
        });
        if (!permitido) {
          return responderJson(res, 429, { error: 'RATE_LIMIT', reintentarEn }, { 'Retry-After': String(reintentarEn) });
        }
      }
      const ultimoId = req.headers['last-event-id'] || url.searchParams.get('lastEventId') || null;
      // `retry` aleatorio: si la instancia muere, sus clientes no vuelven todos a la vez (RF-10).
      const conexion = p.conexiones.agregar(
        new SseConnection(res, { retryMs: 1_000 + Math.floor(Math.random() * 4_000) }),
      );
      await servicio.conectar(conexion, topicos, ultimoId);
    });

    p.router.http('/api/publico/snapshot', async (_req, res, url) => {
      const topico = url.searchParams.get('topic') ?? 'dep';
      if (!esTopicoValido(topico)) return responderJson(res, 400, { error: 'TOPICO_INVALIDO' });
      responderJson(res, 200, await repositorio.fotografia(topico), { 'Cache-Control': 'no-store' });
    });

    p.router.http('/api/vitals', async (req, res) => {
      if (req.method !== 'POST') return responderJson(res, 405, { error: 'METODO' });
      let cuerpo = '';
      for await (const trozo of req) {
        cuerpo += trozo;
        if (cuerpo.length > MAX_CUERPO_VITALS) return responderJson(res, 413, { error: 'DEMASIADO_GRANDE' });
      }
      let muestra;
      try {
        muestra = JSON.parse(cuerpo);
      } catch {
        return responderJson(res, 400, { error: 'JSON' });
      }
      const valor = Number(muestra?.value);
      if (muestra?.name !== 'INP' || !Number.isFinite(valor) || valor < 0 || valor > 60_000) {
        return responderJson(res, 400, { error: 'MUESTRA_INVALIDA' });
      }
      await repositorio.guardarInp(valor);
      res.writeHead(204).end();
    });

    p.contenedor.registrar('publicoService', servicio);
  },
};

function responderJson(res, status, cuerpo, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(cuerpo));
}
