import { HttpError } from '../errors/HttpError.js';
import { extraerToken, fuenteDeRequest, fuenteDeIncomingMessage } from './credenciales.js';

/**
 * Casos de uso de autenticación y autorización.
 * Depende de abstracciones (repositorio, hasher, tokens): se puede probar sin Supabase.
 */
export class AuthService {
  /**
   * @param {{ usuarios: import('./UsuariosRepository.js').UsuariosRepository,
   *           hasher: import('./PasswordHasher.js').PasswordHasher,
   *           tokens: import('./TokenService.js').TokenService }} deps
   */
  constructor({ usuarios, hasher, tokens }) {
    this.usuarios = usuarios;
    this.hasher = hasher;
    this.tokens = tokens;
  }

  /** @returns {Promise<{ token: string, usuario: { sub, rol, nombre, mesa } }>} */
  async login({ username, password }) {
    const registro = await this.#buscarUsuario(username);
    const valido = await this.hasher.coincide(password, registro?.password_hash);
    if (!registro || !valido) {
      throw new HttpError(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos');
    }
    const usuario = {
      sub: registro.id,
      rol: registro.rol,
      nombre: registro.nombre,
      mesa: registro.mesa ?? null,
    };
    return { token: await this.tokens.firmar(usuario), usuario };
  }

  /** Si el almacén de usuarios no responde: 503 explícito, no un 500 ni una espera larga. */
  async #buscarUsuario(username) {
    try {
      return await this.usuarios.buscarPorUsername(username);
    } catch {
      throw new HttpError(503, 'AUTENTICACION_NO_DISPONIBLE', 'No se pudo verificar el usuario', {
        headers: { 'Retry-After': '5' },
      });
    }
  }

  /** Usuario del token o `null`. */
  verificarToken(token) {
    return this.tokens.verificar(token);
  }

  /** @param {Request} request */
  usuarioDeRequest(request) {
    return this.verificarToken(extraerToken(fuenteDeRequest(request)));
  }

  /** @param {import('node:http').IncomingMessage} req */
  usuarioDeIncomingMessage(req, { permitirQuery = false } = {}) {
    return this.verificarToken(extraerToken(fuenteDeIncomingMessage(req), { permitirQuery }));
  }

  /**
   * Lanza 401/403 si el usuario no existe o no tiene uno de los roles.
   * @param {object|null} usuario
   * @param {string[]} roles  vacío = cualquier rol autenticado
   */
  autorizar(usuario, roles) {
    if (!usuario) throw HttpError.noAutenticado();
    if (roles.length > 0 && !roles.includes(usuario.rol)) throw HttpError.prohibido();
    return usuario;
  }

  /**
   * Guardia para rutas HTTP: `requireRol(Rol.AUDITOR, Rol.COORDINADOR)`.
   * Deja el usuario en `contexto.usuario`.
   * @param {...string} roles
   */
  requireRol(...roles) {
    return async (request, contexto) => {
      contexto.usuario = this.autorizar(await this.usuarioDeRequest(request), roles);
    };
  }
}
