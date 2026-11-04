import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { AuthService } from '../../src/server/core/auth/AuthService.js';
import { PasswordHasher } from '../../src/server/core/auth/PasswordHasher.js';
import { TokenService } from '../../src/server/core/auth/TokenService.js';

const tokens = new TokenService({ secreto: 'x'.repeat(64) });
const hash = bcrypt.hashSync('clave-ana', 4);
const repositorioCon = (usuario) => ({ buscarPorUsername: async () => usuario });
const ana = {
  id: 'u-1',
  username: 'ana',
  password_hash: hash,
  rol: 'AUDITOR',
  nombre: 'Ana',
  mesa: null,
};

describe('AuthService', () => {
  const hasher = new PasswordHasher({ costo: 4 });

  it('login correcto devuelve un JWT válido con sub/rol/nombre', async () => {
    const auth = new AuthService({ usuarios: repositorioCon(ana), hasher, tokens });
    const { token, usuario } = await auth.login({ username: 'ana', password: 'clave-ana' });
    expect(usuario).toEqual({ sub: 'u-1', rol: 'AUDITOR', nombre: 'Ana', mesa: null });
    expect(await auth.verificarToken(token)).toMatchObject({ sub: 'u-1', rol: 'AUDITOR' });
  });

  it('contraseña o usuario incorrectos → 401 con el mismo código', async () => {
    const conAna = new AuthService({ usuarios: repositorioCon(ana), hasher, tokens });
    const sinUsuario = new AuthService({ usuarios: repositorioCon(null), hasher, tokens });
    await expect(conAna.login({ username: 'ana', password: 'mal' })).rejects.toMatchObject({
      status: 401,
      codigo: 'CREDENCIALES_INVALIDAS',
    });
    await expect(sinUsuario.login({ username: 'nadie', password: 'x' })).rejects.toMatchObject({
      status: 401,
      codigo: 'CREDENCIALES_INVALIDAS',
    });
  });

  it('si Supabase no responde → 503 explícito', async () => {
    const caido = {
      buscarPorUsername: async () => {
        throw new Error('fetch failed');
      },
    };
    const auth = new AuthService({ usuarios: caido, hasher, tokens });
    await expect(auth.login({ username: 'ana', password: 'x' })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('requireRol: 401 sin token, 403 con rol ajeno', async () => {
    const auth = new AuthService({ usuarios: repositorioCon(ana), hasher, tokens });
    const guardia = auth.requireRol('COORDINADOR');
    await expect(guardia(new Request('http://x/'), {})).rejects.toMatchObject({ status: 401 });
    const jwt = await tokens.firmar({ sub: 'u-1', rol: 'AUDITOR', nombre: 'Ana' });
    const conToken = new Request('http://x/', { headers: { authorization: `Bearer ${jwt}` } });
    await expect(guardia(conToken, {})).rejects.toMatchObject({ status: 403 });
  });
});
