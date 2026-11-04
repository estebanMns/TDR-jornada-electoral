import { Plataforma } from './core/Plataforma.js';
import { publicarContenedor } from './contenedorGlobal.js';
import { moduloVerificacion } from './modules/verificacion/index.js';
import { moduloOps } from './modules/ops/index.js';
import { moduloActas } from './modules/actas/index.js';

/**
 * Módulos de negocio: UNA línea por módulo (cada dueño agrega la suya).
 * @type {import('./core/Plataforma.js').Modulo[]}
 */
const MODULOS = [
  moduloVerificacion, // Meneses
  moduloOps, // Meneses
  moduloActas, // Jose
  // moduloPublico,   // Evelyn
];

/** Construye la aplicación completa de una instancia. */
export function crearAplicacion(env = process.env) {
  const plataforma = Plataforma.desdeEntorno(env);
  for (const modulo of MODULOS) plataforma.usar(modulo);
  publicarContenedor(plataforma.contenedor);
  return plataforma;
}
