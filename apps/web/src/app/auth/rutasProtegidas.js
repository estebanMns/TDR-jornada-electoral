import { Rol, INICIO_POR_ROL } from '@preconteo/shared/roles';

/** Qué roles pueden abrir cada sección (GENERAL §5). El primer prefijo que coincide gana. */
const RUTAS_PROTEGIDAS = Object.freeze([
  { prefijo: '/verificacion', roles: [Rol.AUDITOR, Rol.COORDINADOR] },
  { prefijo: '/coordinacion', roles: [Rol.COORDINADOR] },
  { prefijo: '/ops', roles: [Rol.ADMIN] },
  { prefijo: '/jurado', roles: [Rol.JURADO] },
]);

/** @returns {{ prefijo: string, roles: string[] } | null} */
export function reglaDeAcceso(pathname) {
  return (
    RUTAS_PROTEGIDAS.find(
      ({ prefijo }) => pathname === prefijo || pathname.startsWith(`${prefijo}/`),
    ) ?? null
  );
}

export function inicioDe(rol) {
  return INICIO_POR_ROL[rol] ?? '/';
}

/** Solo rutas internas como destino tras el login (evita redirecciones abiertas). */
export function destinoSeguro(siguiente, rol) {
  if (typeof siguiente === 'string' && siguiente.startsWith('/') && !siguiente.startsWith('//')) {
    const regla = reglaDeAcceso(siguiente);
    if (!regla || regla.roles.includes(rol)) return siguiente;
  }
  return inicioDe(rol);
}
