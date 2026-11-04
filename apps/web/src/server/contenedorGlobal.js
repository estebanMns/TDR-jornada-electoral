/**
 * Puente entre el servidor propio (server.js) y las rutas de Next.
 *
 * Next empaqueta las rutas en su propio grafo de módulos, así que un singleton
 * importado allí sería OTRA instancia. Por eso el contenedor se publica en
 * `globalThis` con un Symbol global y las rutas solo leen desde aquí.
 * Este archivo no importa nada más a propósito.
 */
const CLAVE = Symbol.for('preconteo.contenedor');

export function publicarContenedor(contenedor) {
  globalThis[CLAVE] = contenedor;
}

/** @returns {import('./core/Contenedor.js').Contenedor} */
export function obtenerContenedor() {
  const contenedor = globalThis[CLAVE];
  if (!contenedor) {
    throw new Error(
      'Contenedor no inicializado: arranca la app con `node server.js`, no con `next dev`.',
    );
  }
  return contenedor;
}

/**
 * Adaptador para `route.js`: `export const POST = accion('auth', 'login')`.
 * @param {string} controlador
 * @param {string} metodo
 */
export function accion(controlador, metodo) {
  return (request, contexto) =>
    obtenerContenedor().controlador(controlador)[metodo](request, contexto);
}
