import { onINP } from 'web-vitals';

let registrado = false;

/** RT-9: envía el INP medido en el teléfono del usuario para verlo en /ops. */
export function reportarInp() {
  if (registrado) return;
  registrado = true;
  onINP(
    ({ name, value }) => {
      const cuerpo = JSON.stringify({ name, value });
      if (!navigator.sendBeacon?.('/api/vitals', cuerpo)) {
        fetch('/api/vitals', { method: 'POST', body: cuerpo, keepalive: true }).catch(() => {});
      }
    },
    { reportAllChanges: true },
  );
}
