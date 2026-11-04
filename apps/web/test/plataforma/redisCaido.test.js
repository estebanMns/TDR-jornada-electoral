import { describe, it, expect, afterEach } from 'vitest';
import { RedisGateway } from '../../src/server/core/redis/RedisGateway.js';
import { ManejadorHttp } from '../../src/server/core/http/ManejadorHttp.js';
import { PlataformaController } from '../../src/server/core/plataforma/PlataformaController.js';
import { loggerSilencioso, esperarHasta } from '../helpers/redisDePrueba.js';

/**
 * RF-10: con Redis caído la instancia lo dice explícitamente.
 * Se simula apuntando a un puerto donde no hay Redis (equivale a `docker stop redis`).
 * La parte de ingesta (503 NO_REGISTRADA) la cubre Jose con el mismo `estadoRedis()`.
 */
describe('RF-10 Redis caído', () => {
  let redis;
  afterEach(() => redis?.detener());

  it('health → 503, whoami → degradado y las operaciones fallan rápido', async () => {
    redis = new RedisGateway({
      url: 'redis://localhost:6399',
      logger: loggerSilencioso,
      intervaloPingMs: 50,
    });
    redis.iniciar();
    const controlador = new PlataformaController({
      instancia: 'app3',
      redis,
      http: new ManejadorHttp({ logger: loggerSilencioso }),
    });

    const health = await controlador.health(new Request('http://x/api/health'));
    expect(health.status).toBe(503);
    expect(await (await controlador.whoami(new Request('http://x/api/whoami'))).json()).toEqual({
      instancia: 'app3',
      redis: 'degradado',
    });

    const inicio = Date.now();
    await expect(redis.ejecutar((r) => r.get('x'))).rejects.toMatchObject({
      name: 'RedisNoDisponibleError',
    });
    expect(Date.now() - inicio).toBeLessThan(50);
  });

  it('vuelve a ok y emite cambioEstado cuando Redis responde', async () => {
    redis = new RedisGateway({
      url: process.env.REDIS_TEST_URL ?? 'redis://localhost:6380',
      logger: loggerSilencioso,
      intervaloPingMs: 50,
    });
    const cambios = [];
    redis.on('cambioEstado', (nuevo) => cambios.push(nuevo));
    redis.iniciar();
    await esperarHasta(() => redis.disponible(), 2_000);
    expect(cambios).toContain('ok');
  });
});
