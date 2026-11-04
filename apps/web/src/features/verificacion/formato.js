/** 65_000 → "1:05"; 3_900_000 → "1 h 05 min" */
export function duracion(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  if (horas > 0) return `${horas} h ${String(minutos).padStart(2, '0')} min`;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

export const ETIQUETA_MOTIVO = Object.freeze({
  DESCUADRE: 'No cuadra',
  SUFRAGANTES_EXCEDEN: 'Sufragantes > habilitados',
  CONFLICTO: 'Conflicto de versión',
});

export const ETIQUETA_PRIORIDAD = Object.freeze({ 1: 'Alta', 2: 'Media', 3: 'Baja' });

export const MENSAJE_ERROR = Object.freeze({
  YA_TOMADO: 'Otro auditor tomó ese caso primero.',
  NO_EXISTE: 'El caso ya no está en la cola.',
  LOCK_PERDIDO: 'Perdiste el caso (expiró por inactividad o se reasignó).',
  DESCUADRE: 'La corrección no cumple la regla contable.',
  APLICACION_FALLIDA: 'No se pudo aplicar la decisión; el caso volvió a la cola.',
  REDIS_NO_DISPONIBLE: 'Servicio degradado: acciones deshabilitadas temporalmente.',
  SIN_CONEXION: 'Sin conexión con el servidor.',
  SIN_RESPUESTA: 'El servidor no respondió a tiempo.',
  MENSAJE_INVALIDO: 'Solicitud inválida.',
});
