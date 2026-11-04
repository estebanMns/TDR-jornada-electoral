/**
 * Backoff exponencial con "full jitter" (RF-10): espera aleatoria entre 0 y
 * min(techo, base · 2^intento). Si una instancia cae, sus miles de clientes no
 * reconectan todos en el mismo instante contra las que quedan.
 *
 * @param {number} intento 0, 1, 2…
 * @param {{ baseMs?: number, techoMs?: number, aleatorio?: () => number }} [opciones]
 */
export function esperaConJitter(intento, { baseMs = 500, techoMs = 30_000, aleatorio = Math.random } = {}) {
  const techo = Math.min(techoMs, baseMs * 2 ** Math.max(0, intento));
  return Math.floor(Math.min(1, Math.max(0, aleatorio())) * techo);
}
