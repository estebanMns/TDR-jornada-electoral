import { loginSchema } from '@preconteo/shared/schemas/auth';
import { json } from '../http/ManejadorHttp.js';
import { COOKIE_SESION, ipCliente } from './credenciales.js';

const UNIDADES = { s: 1, m: 60, h: 3600, d: 86400 };

/** '8h' → 28800 */
export function duracionASegundos(texto) {
  const coincidencia = /^(\d+)([smhd])$/.exec(texto);
  if (!coincidencia) throw new Error(`Duración inválida: ${texto}`);
  return Number(coincidencia[1]) * UNIDADES[coincidencia[2]];
}

/** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/sesion`. */
export class AuthController {
  /**
   * @param {{ auth: import('./AuthService.js').AuthService,
   *           limitador: import('../rateLimit/RateLimiter.js').RateLimiter,
   *           http: import('../http/ManejadorHttp.js').ManejadorHttp,
   *           config: import('../config/Config.js').Config }} deps
   */
  constructor({ auth, limitador, http, config }) {
    const maxAge = duracionASegundos(config.jwt.expiracion);
    const seguro = config.esProduccion ? '; Secure' : '';
    const cookie = (valor, edad) =>
      `${COOKIE_SESION}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${edad}${seguro}`;

    const limiteLogin = limitador.rateLimit({
      clave: (request) => `login:${ipCliente(request.headers)}`,
      limite: 10,
      ventanaSeg: 60,
    });

    this.login = http.ruta([limiteLogin], async (request) => {
      const credenciales = await http.leerJson(request, loginSchema);
      const { token, usuario } = await auth.login(credenciales);
      return json({ token, usuario }, { headers: { 'Set-Cookie': cookie(token, maxAge) } });
    });

    this.logout = http.ruta([], async () =>
      json({ ok: true }, { headers: { 'Set-Cookie': cookie('', 0) } }),
    );

    this.sesion = http.ruta([auth.requireRol()], async (_request, { usuario }) =>
      json({ usuario }),
    );
  }
}
