/**
 * Todas las claves y canales de Redis (GENERAL §7 y §8).
 * Nadie escribe una clave a mano: se construye aquí.
 *
 * Solo se muestran las secciones de Meneses + las que Meneses consume (verif:*).
 * Jose y Evelyn agregan sus secciones por PR (cambios aditivos).
 */

export const verificacion = Object.freeze({
  /** ZSET acta → score (menor score = mayor prioridad). Lo llena Jose. */
  cola: 'verif:queue',
  /** HASH acta → JSON { auditor, nombre, desde, fencing, score }. */
  tomados: 'verif:taken',
  /** STRING JSON con el caso (ver `casoVerificacionSchema`). Lo escribe Jose. */
  caso: (acta) => `verif:case:${acta}`,
  /** HASH de contadores agregados: `resueltos`. */
  estadisticas: 'verif:stats',
  /** Canal Pub/Sub de la consola de auditoría. */
  canal: 'ch:verif',
});

export const bloqueo = Object.freeze({
  prefijoActa: 'lock:acta:',
  /** STRING `{auditor}:{token}` con `SET NX PX`. */
  acta: (acta) => `lock:acta:${acta}`,
  /** Secuencia monótona para el fencing token. */
  secuenciaFencing: 'fence:seq',
});

export const presencia = Object.freeze({
  /** STRING JSON con TTL (latido). */
  de: (sub) => `presence:${sub}`,
  /** ZSET sub → último latido (ms). */
  indice: 'presence:idx',
  canal: 'ch:presence',
});

export const limiteTasa = Object.freeze({
  /** Contador de ventana fija. */
  contador: (credencial, ventana) => `rl:${credencial}:${ventana}`,
});

export const metricas = Object.freeze({
  /** HASH con la última fotografía de métricas de una instancia (EX 10). */
  instancia: (id) => `metrics:inst:${id}`,
  /** ZSET instancia → último reporte (ms). */
  instancias: 'metrics:instances',
});
