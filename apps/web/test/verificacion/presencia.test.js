import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PresenciaRepository } from '../../src/server/modules/verificacion/presencia.repository.js';
import { PresenciaService } from '../../src/server/modules/verificacion/presencia.service.js';
import { crearRedisDePrueba, CanalEnMemoria, esperarHasta } from '../helpers/redisDePrueba.js';

const usuario = { sub: 'aud-1', nombre: 'Ana', rol: 'AUDITOR' };

describe('RF-8 presencia (Redis real)', () => {
  let redis;
  beforeEach(async () => {
    redis = await crearRedisDePrueba();
  });
  afterEach(() => redis.detener());

  it('sin latido, el auditor sale de la lista en ≤ TTL', async () => {
    const canal = new CanalEnMemoria();
    // TTL de 1 s para que la prueba sea rápida; en producción son 30 s.
    const servicio = new PresenciaService({
      repositorio: new PresenciaRepository({ redis, ttlSeg: 1 }),
      canal,
      instancia: 'app1',
    });
    await servicio.latido(usuario, { caso: null, activo: true, conectadoDesde: Date.now() });
    expect(await servicio.listar()).toHaveLength(1);

    const inicio = Date.now();
    await esperarHasta(async () => (await servicio.listar()).length === 0, 2_500);
    expect(Date.now() - inicio).toBeLessThanOrEqual(1_500);
  });

  it('solo publica cuando cambia algo visible y borra al salir', async () => {
    const canal = new CanalEnMemoria();
    const servicio = new PresenciaService({
      repositorio: new PresenciaRepository({ redis }),
      canal,
      instancia: 'app1',
    });
    const estado = { caso: null, activo: true, conectadoDesde: Date.now() };
    await servicio.latido(usuario, estado);
    await servicio.latido(usuario, estado);
    await servicio.latido(usuario, { ...estado, caso: { acta: 'E14-1', desde: Date.now() } });
    expect(canal.publicados.filter((m) => m.tipo === 'cambio')).toHaveLength(2);

    await servicio.salir(usuario.sub);
    expect(await servicio.listar()).toEqual([]);
  });
});
