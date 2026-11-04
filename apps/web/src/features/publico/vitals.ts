/** Sends INP samples of the public page (RT-9). Loaded only by the public route. */
export async function reportInp(): Promise<void> {
  const { onINP } = await import('web-vitals');
  onINP(({ value }) => {
    // text/plain: no CORS preflight; the server parses it as JSON.
    const body = new Blob([JSON.stringify({ name: 'INP', value })], { type: 'text/plain' });
    if (!navigator.sendBeacon?.('/api/vitals', body)) {
      void fetch('/api/vitals', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  });
}
