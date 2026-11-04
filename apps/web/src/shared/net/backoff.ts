export function backoffDelay(attempt: number, random = Math.random): number {
  const ceiling = Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
  return Math.floor(Math.max(0, Math.min(1, random())) * ceiling);
}
