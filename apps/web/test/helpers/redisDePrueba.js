import pino from 'pino';
import { RedisGateway } from '../../src/server/core/redis/RedisGateway.js';

export const URL_REDIS_PRUEBA = process.env.REDIS_TEST_URL ?? 'redis://localhost:6380';
export const loggerSilencioso = pino({ level: 'silent' });

/** Gateway contra el Redis de pruebas, ya disponible y vacío. */
export async function crearRedisDePrueba(url = URL_REDIS_PRUEBA) {
  const redis = new RedisGateway({ url, logger: loggerSilencioso, intervaloPingMs: 100 });
  redis.iniciar();
  await esperarHasta(() => redis.disponible(), 3_000);
  await redis.comandos.flushdb();
  return redis;
}

export async function esperarHasta(condicion, maxMs, pasoMs = 25) {
  const limite = Date.now() + maxMs;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await dormir(pasoMs);
  }
  throw new Error(`La condición no se cumplió en ${maxMs} ms`);
}

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Doble de prueba del canal Pub/Sub: guarda lo publicado. */
export class CanalEnMemoria {
  publicados = [];
  async publicar(m) {
    this.publicados.push(m);
  }
  async publicarSinFallar(m) {
    this.publicados.push(m);
  }
  escuchar() {
    return () => {};
  }
}

export const metricsNulas = { inc() {}, observe() {}, gauge() {} };
