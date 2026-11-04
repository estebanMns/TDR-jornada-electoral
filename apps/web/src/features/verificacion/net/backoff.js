/**
 * Backoff exponencial con full jitter (GENERAL §9.4):
 * espera = random(0, min(tope, base · 2^intento)).
 * Reemplazar por `shared/net/backoff` de Evelyn cuando esté en main (misma fórmula).
 */
export function esperaConJitter(
  intento,
  { baseMs = 500, topeMs = 30_000, aleatorio = Math.random } = {},
) {
  return Math.round(aleatorio() * Math.min(topeMs, baseMs * 2 ** intento));
}
