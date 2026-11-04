const CLAVE = 'preconteo.casoEnCurso';

/**
 * Caso tomado por esta pestaña (acta + token) en sessionStorage: sobrevive a una
 * recarga para poder seguir renovando el lease, y no se comparte entre pestañas.
 */
export const AlmacenCasoEnCurso = Object.freeze({
  /** @returns {{ acta: string, token: string, expiraEn: number } | null} */
  leer() {
    try {
      return JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null');
    } catch {
      return null;
    }
  },

  guardar(caso) {
    try {
      sessionStorage.setItem(CLAVE, JSON.stringify(caso));
    } catch {
      /* almacenamiento no disponible: el caso vive solo en memoria */
    }
  },

  limpiar() {
    try {
      sessionStorage.removeItem(CLAVE);
    } catch {
      /* idem */
    }
  },
});
