import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { redisKeys } from '@preconteo/shared';
import { Decision } from '@preconteo/shared/schemas/verificacion';
import { VerificacionRepository } from '../../src/server/modules/verificacion/verificacion.repository.js';
import { VerificacionService } from '../../src/server/modules/verificacion/verificacion.service.js';
import {
  encolarCasoFalso,
  casoDeEjemplo,
} from '../../src/server/modules/verificacion/dev/casosFalsos.js';
import {
  crearRedisDePrueba,
  CanalEnMemoria,
  metricsNulas,
  dormir,
} from '../helpers/redisDePrueba.js';

const auditor = (n) => ({ sub: `aud-${n}`, nombre: `Auditor ${n}`, rol: 'AUDITOR' });

function crearServicio(redis, { ttlMs = 30_000, actas } = {}) {
  const aplicadas = [];
  const canal = new CanalEnMemoria();
  const servicio = new VerificacionService({
    repositorio: new VerificacionRepository({ redis, ttlMs }),
    historial: { registrarDecision: async () => true },
    actas: actas ?? { aplicarResolucion: async (r) => aplicadas.push(r) },
    canal,
    metrics: metricsNulas,
  });
  return { servicio, canal, aplicadas };
}

describe('RF-7 lease de verificación (Redis real)', () => {
  let redis;
  let caso;

  beforeEach(async () => {
    redis = await crearRedisDePrueba();
    caso = await encolarCasoFalso(redis.comandos, casoDeEjemplo(1));
  });

  afterEach(() => redis.detener());

  it('exclusividad: 20 tomas concurrentes del mismo caso → exactamente 1 éxito', async () => {
    const { servicio } = crearServicio(redis);
    const intentos = Array.from({ length: 20 }, (_, i) => servicio.tomar(auditor(i), caso.acta));
    const resultados = await Promise.allSettled(intentos);

    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazos = resultados.filter((r) => r.status === 'rejected');
    expect(exitos).toHaveLength(1);
    expect(rechazos.every((r) => r.reason.codigo === 'YA_TOMADO')).toBe(true);
    expect(await redis.comandos.zscore(redisKeys.verificacion.cola, caso.acta)).toBeNull();
  });

  it('liberación segura: el token vencido de A no resuelve ni suelta; el lock de B sigue', async () => {
    const { servicio, aplicadas } = crearServicio(redis, { ttlMs: 150 });
    const a = await servicio.tomar(auditor('A'), caso.acta);

    await dormir(250); // el lease de A expira
    await servicio.liberarExpirados(); // el reaper lo devuelve a la cola
    const b = await servicio.tomar(auditor('B'), caso.acta);
    expect(b.fencing).toBeGreaterThan(a.fencing);

    await expect(
      servicio.resolver(auditor('A'), {
        acta: caso.acta,
        token: a.token,
        decision: Decision.APROBAR,
      }),
    ).rejects.toMatchObject({ codigo: 'LOCK_PERDIDO' });
    await expect(
      servicio.soltar(auditor('A'), { acta: caso.acta, token: a.token }),
    ).rejects.toMatchObject({
      codigo: 'LOCK_PERDIDO',
    });

    expect(aplicadas).toHaveLength(0);
    expect(await redis.comandos.get(redisKeys.bloqueo.acta(caso.acta))).toBe(`aud-B:${b.token}`);
  });

  it('el mismo token pero de otro usuario tampoco sirve', async () => {
    const { servicio } = crearServicio(redis);
    const a = await servicio.tomar(auditor('A'), caso.acta);
    await expect(
      servicio.soltar(auditor('X'), { acta: caso.acta, token: a.token }),
    ).rejects.toMatchObject({
      codigo: 'LOCK_PERDIDO',
    });
  });

  it('reaper: lock expirado → el caso vuelve a verif:queue con su prioridad', async () => {
    const { servicio, canal } = crearServicio(redis, { ttlMs: 100 });
    const scoreOriginal = await redis.comandos.zscore(redisKeys.verificacion.cola, caso.acta);
    await servicio.tomar(auditor('A'), caso.acta);

    await dormir(200);
    expect(await servicio.liberarExpirados()).toEqual([caso.acta]);
    expect(await redis.comandos.zscore(redisKeys.verificacion.cola, caso.acta)).toBe(scoreOriginal);
    expect(await redis.comandos.hexists(redisKeys.verificacion.tomados, caso.acta)).toBe(0);
    expect(canal.publicados.at(-1)).toMatchObject({ tipo: 'caso_liberado', acta: caso.acta });
    expect(await servicio.liberarExpirados()).toEqual([]); // idempotente
  });

  it('latido con actividad reciente renueva; inactivo > 5 min no renueva', async () => {
    const { servicio } = crearServicio(redis, { ttlMs: 300 });
    const a = await servicio.tomar(auditor('A'), caso.acta);
    const clave = redisKeys.bloqueo.acta(caso.acta);

    const activo = await servicio.latido(auditor('A'), {
      actividad: Date.now(),
      inactivoMs: 1_000,
      acta: caso.acta,
      token: a.token,
    });
    expect(activo.renovacion).toBe('RENOVADO');

    await redis.comandos.pexpire(clave, 50);
    const inactivo = await servicio.latido(auditor('A'), {
      actividad: Date.now(),
      inactivoMs: 6 * 60_000,
      acta: caso.acta,
      token: a.token,
    });
    expect(inactivo.renovacion).toBe('INACTIVO');
    await dormir(100);
    expect(await redis.comandos.exists(clave)).toBe(0);
  });

  it('resolver aplica con el fencing y cierra el caso; si actas falla se compensa', async () => {
    const { servicio, aplicadas } = crearServicio(redis);
    const a = await servicio.tomar(auditor('A'), caso.acta);
    await servicio.resolver(auditor('A'), {
      acta: caso.acta,
      token: a.token,
      decision: Decision.APROBAR,
    });
    expect(aplicadas[0]).toMatchObject({
      acta: caso.acta,
      fencing: a.fencing,
      decision: 'APROBAR',
    });
    expect(await redis.comandos.exists(redisKeys.verificacion.caso(caso.acta))).toBe(0);

    const otro = await encolarCasoFalso(redis.comandos, casoDeEjemplo(2));
    const fallido = crearServicio(redis, {
      actas: {
        aplicarResolucion: async () => {
          throw new Error('caído');
        },
      },
    }).servicio;
    const b = await fallido.tomar(auditor('B'), otro.acta);
    await expect(
      fallido.resolver(auditor('B'), {
        acta: otro.acta,
        token: b.token,
        decision: Decision.RECHAZAR,
        motivo: 'ilegible',
      }),
    ).rejects.toMatchObject({ codigo: 'APLICACION_FALLIDA' });
    expect(await redis.comandos.zscore(redisKeys.verificacion.cola, otro.acta)).not.toBeNull();
    expect(await redis.comandos.exists(redisKeys.verificacion.caso(otro.acta))).toBe(1);
  });

  it('una corrección que no cuadra se rechaza sin consumir el lock', async () => {
    const { servicio } = crearServicio(redis);
    const a = await servicio.tomar(auditor('A'), caso.acta);
    await expect(
      servicio.resolver(auditor('A'), {
        acta: caso.acta,
        token: a.token,
        decision: Decision.APROBAR_CON_CORRECCION,
        votos: { C1: 1 },
      }),
    ).rejects.toMatchObject({ codigo: 'DESCUADRE' });
    expect(await redis.comandos.exists(redisKeys.bloqueo.acta(caso.acta))).toBe(1);
  });

  it('estado_cola incluye pendientes, tomados (con nombre) y contadores', async () => {
    await encolarCasoFalso(redis.comandos, casoDeEjemplo(2));
    const { servicio } = crearServicio(redis);
    await servicio.tomar(auditor('A'), caso.acta);
    const { items, contadores } = await servicio.estadoCola();
    expect(contadores).toEqual({ pendientes: 1, enCurso: 1, resueltos: 0 });
    expect(items.find((i) => i.acta === caso.acta).tomadoPor).toMatchObject({
      nombre: 'Auditor A',
    });
  });
});
