import { describe, expect, it } from 'vitest';
import { TokenService } from '../../src/server/core/auth/TokenService.js';
import {
  ActasServiceUnavailableError,
  RemoteActasService,
} from '../../src/server/modules/actas/RemoteActasService.js';
import { loggerSilencioso } from '../helpers/redisDePrueba.js';

const SECRET = 'x'.repeat(64);
const tokens = new TokenService({ secreto: SECRET });

function fakeFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 });
  };
  return { impl, calls };
}

function service(fetchImpl) {
  return new RemoteActasService({
    baseUrl: 'http://actas:3001',
    tokens,
    logger: loggerSilencioso,
    fetchImpl,
  });
}

const resolution = {
  acta: 'E14-176-0042-03',
  version: 2,
  votos: { C1: 10, C2: 5 },
  sufragantes: 15,
  decision: 'APROBAR_CON_CORRECCION',
  auditor: 'auditor-uuid',
  fencing: 41,
  motivo: 'Corregido contra la foto',
};

describe('RemoteActasService (actas port over HTTP)', () => {
  it('maps the decision and forwards it with an auditor token', async () => {
    const { impl, calls } = fakeFetch({ body: { result: 'RESOLVED', status: 'APPLIED' } });
    const receipt = await service(impl).aplicarResolucion(resolution);

    expect(receipt).toEqual({ result: 'RESOLVED', status: 'APPLIED' });
    expect(calls[0].url).toBe('http://actas:3001/api/actas/resolutions');
    expect(calls[0].body).toEqual({
      actaId: 'E14-176-0042-03',
      version: 2,
      decision: 'APPROVE_WITH_CORRECTION',
      auditor: 'auditor-uuid',
      fencing: 41,
      votes: { C1: 10, C2: 5 },
      voters: 15,
      reason: 'Corregido contra la foto',
    });
    const token = calls[0].init.headers.authorization.replace('Bearer ', '');
    expect(await tokens.verificar(token)).toMatchObject({ sub: 'auditor-uuid', rol: 'AUDITOR' });
  });

  it('does not send votes when approving or rejecting as registered', async () => {
    const { impl, calls } = fakeFetch({ body: { result: 'RESOLVED' } });
    await service(impl).aplicarResolucion({ ...resolution, decision: 'RECHAZAR' });
    expect(calls[0].body.decision).toBe('REJECT');
    expect(calls[0].body).not.toHaveProperty('votes');
  });

  it('throws when the actas service fails so the case is re-enqueued', async () => {
    const down = fakeFetch(new TypeError('fetch failed'));
    await expect(service(down.impl).aplicarResolucion(resolution)).rejects.toBeInstanceOf(
      ActasServiceUnavailableError,
    );
    const unavailable = fakeFetch({ status: 503, body: { result: 'NOT_REGISTERED' } });
    await expect(service(unavailable.impl).aplicarResolucion(resolution)).rejects.toBeInstanceOf(
      ActasServiceUnavailableError,
    );
  });
});
