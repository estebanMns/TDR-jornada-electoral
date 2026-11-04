/**
 * Roles del sistema (GENERAL §4). PUBLICO no tiene login, por eso no aparece aquí.
 * @readonly
 */
export const Rol = Object.freeze({
  JURADO: 'JURADO',
  AUDITOR: 'AUDITOR',
  COORDINADOR: 'COORDINADOR',
  ADMIN: 'ADMIN',
});

export const ROLES = Object.freeze(Object.values(Rol));

/** Roles que pueden abrir la consola de verificación. */
export const ROLES_VERIFICACION = Object.freeze([Rol.AUDITOR, Rol.COORDINADOR]);

/** Pantalla de inicio de cada rol tras el login. */
export const INICIO_POR_ROL = Object.freeze({
  [Rol.JURADO]: '/jurado',
  [Rol.AUDITOR]: '/verificacion',
  [Rol.COORDINADOR]: '/coordinacion',
  [Rol.ADMIN]: '/ops',
});
