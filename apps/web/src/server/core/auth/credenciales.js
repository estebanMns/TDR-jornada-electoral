/** Nombre de la cookie httpOnly con el JWT. */
export const COOKIE_SESION = 'preconteo_sesion';

/** Lee una cookie de un header `Cookie` crudo. */
export function leerCookie(headerCookie, nombre) {
  if (!headerCookie) return null;
  for (const parte of headerCookie.split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return null;
}

/**
 * Extrae el JWT de una petición. Orden: `Authorization: Bearer`, cookie de sesión
 * y, solo si se permite (WebSocket), `?token=`.
 *
 * @param {{ authorization?: string|null, cookie?: string|null, url?: string }} fuente
 * @param {{ permitirQuery?: boolean }} [opciones]
 */
export function extraerToken({ authorization, cookie, url }, { permitirQuery = false } = {}) {
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
  const deCookie = leerCookie(cookie, COOKIE_SESION);
  if (deCookie) return deCookie;
  if (permitirQuery && url) return new URL(url, 'http://localhost').searchParams.get('token');
  return null;
}

/** Adaptador para `Request` (Web/Next). */
export const fuenteDeRequest = (request) => ({
  authorization: request.headers.get('authorization'),
  cookie: request.headers.get('cookie'),
  url: request.url,
});

/** Adaptador para `IncomingMessage` (Node: SSE y upgrade de WS). */
export const fuenteDeIncomingMessage = (req) => ({
  authorization: req.headers.authorization,
  cookie: req.headers.cookie,
  url: req.url,
});

/** IP del cliente detrás de nginx (X-Real-IP lo pone nginx con $remote_addr). */
export function ipCliente(headers) {
  const obtener = (n) => (typeof headers.get === 'function' ? headers.get(n) : headers[n]);
  return (
    obtener('x-real-ip') ||
    String(obtener('x-forwarded-for') ?? '')
      .split(',')[0]
      .trim() ||
    'desconocida'
  );
}
