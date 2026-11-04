import { onINP } from 'web-vitals';
export function reportPublicINP() {
  onINP(metric => {
    const body = JSON.stringify({ name: metric.name, value: metric.value, id: metric.id });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/vitals', new Blob([body], { type: 'application/json' }));
    else void fetch('/api/vitals', { method:'POST', body, headers:{'content-type':'application/json'}, keepalive:true });
  });
}
