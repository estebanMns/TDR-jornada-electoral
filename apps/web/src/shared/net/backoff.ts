/**
 * Exponential backoff with FULL jitter (GENERAL §9.4, owner: Evelyn):
 * wait = random(0, min(cap, base · 2^attempt)). Spreads reconnections so a
 * failed instance does not cause a synchronized avalanche.
 */
export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  random?: () => number;
}

export function backoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const { baseMs = 500, capMs = 30_000, random = Math.random } = options;
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}
