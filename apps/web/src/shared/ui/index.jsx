/**
 * Primitivas visuales de Mesa a Mesa (sistema de diseño mínimo, dueña: Evelyn).
 * Sin dependencias: la página pública debe cargar rápido en un teléfono de gama baja.
 */
export { MapaMesas } from './MapaMesas';
export { BarraPublica } from './BarraPublica';
export { Marca } from './Marca';

export function Tarjeta({ className = '', children, ...props }) {
  return (
    <section className={`rounded-xl border border-rejilla bg-hoja p-5 ${className}`} {...props}>
      {children}
    </section>
  );
}

/** Rótulo de sección al estilo de los encabezados del formulario E-14. */
export function Rotulo({ children, className = '' }) {
  return (
    <p className={`font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-tinta-suave ${className}`}>
      {children}
    </p>
  );
}

const ESTADOS = {
  en_vivo: { color: 'bg-registrada', texto: 'En vivo', pulso: true },
  reconectando: { color: 'bg-revision', texto: 'Reconectando…', pulso: false },
  pausado: { color: 'bg-tinta-suave', texto: 'Actualizaciones pausadas', pulso: false },
};

export function PuntoEstado({ estado }) {
  const { color, texto, pulso } = ESTADOS[estado] ?? ESTADOS.reconectando;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-rejilla bg-hoja px-3 py-1 text-sm font-medium"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2 w-2">
        {pulso && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      {texto}
    </span>
  );
}

export function Dato({ etiqueta, valor, detalle }) {
  return (
    <div>
      <Rotulo>{etiqueta}</Rotulo>
      <p className="mt-1.5 font-display text-3xl font-bold tabular-nums tracking-tight">{valor}</p>
      {detalle && <p className="mt-0.5 text-sm text-tinta-suave">{detalle}</p>}
    </div>
  );
}

export function BarraProgreso({ porcentaje, color, alto = 'h-2.5' }) {
  const ancho = Math.max(0, Math.min(100, porcentaje));
  return (
    <div className={`${alto} overflow-hidden rounded-full bg-papel`}>
      <div
        className="h-full rounded-full bg-indeleble transition-[width] duration-700 ease-out"
        style={{ width: `${ancho}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </div>
  );
}

export const formatoNumero = (n) => Number(n ?? 0).toLocaleString('es-CO');
export const formatoPorcentaje = (n) =>
  `${Number(n ?? 0).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
