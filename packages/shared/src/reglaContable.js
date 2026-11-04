/**
 * Regla contable del acta (GENERAL §6.3):
 * Σ votos de candidatos + BLANCO + NULO + NO_MARCADO = sufragantes.
 * `votos` incluye a los candidatos y a BLANCO, NULO, NO_MARCADO.
 */

/** @param {Record<string, number>} votos */
export function sumarVotos(votos) {
  return Object.values(votos).reduce((total, v) => total + v, 0);
}

/**
 * @param {Record<string, number>} votos
 * @param {number} sufragantes
 * @returns {number} 0 = cuadra; > 0 sobran votos; < 0 faltan.
 */
export function descuadre(votos, sufragantes) {
  return sumarVotos(votos) - sufragantes;
}

/**
 * @param {Record<string, number>} votos
 * @param {number} sufragantes
 */
export function cuadra(votos, sufragantes) {
  return descuadre(votos, sufragantes) === 0;
}
