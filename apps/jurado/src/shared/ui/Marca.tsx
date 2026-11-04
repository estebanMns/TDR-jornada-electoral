import type { ReactNode } from 'react';

/** Marca de Mesa a Mesa: cuatro mesas, tres ya entintadas. Igual que en la plataforma. */
export function Marca({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight ${className}`}>
      <span aria-hidden className="grid grid-cols-2 gap-[2px]">
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-indeleble" />
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-indeleble" />
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-indeleble" />
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-rejilla" />
      </span>
      Mesa a Mesa
    </span>
  );
}

/** Rótulo de sección al estilo de los encabezados del formulario E-14. */
export function Rotulo({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-tinta-suave ${className}`}>
      {children}
    </p>
  );
}
