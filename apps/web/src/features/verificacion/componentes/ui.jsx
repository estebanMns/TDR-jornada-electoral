/**
 * Primitivas visuales mínimas de la consola. Cuando `shared/ui` (Evelyn) esté en
 * main se reemplazan por sus Button/Badge/Card sin tocar el resto de componentes.
 */

const VARIANTES_BOTON = {
  primario: 'bg-indeleble text-white hover:brightness-110 dark:text-papel',
  exito: 'bg-registrada text-white hover:brightness-110',
  peligro: 'bg-red-600 text-white hover:bg-red-500',
  borde: 'border border-rejilla hover:bg-papel',
};

export function Boton({ variante = 'primario', className = '', ...props }) {
  return (
    <button
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTES_BOTON[variante]} ${className}`}
      {...props}
    />
  );
}

const TONOS = {
  neutro: 'bg-papel text-tinta-suave',
  verde: 'bg-registrada/10 text-registrada',
  ambar: 'bg-revision/10 text-revision',
  rojo: 'bg-red-500/10 text-red-800',
};

export function Insignia({ tono = 'neutro', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONOS[tono]}`}
    >
      {children}
    </span>
  );
}

export function Tarjeta({ className = '', children }) {
  return (
    <section
      className={`rounded-xl border border-rejilla bg-hoja p-4 ${className}`}
    >
      {children}
    </section>
  );
}

export function IconoCandado() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-3.5 fill-current">
      <path d="M10 2a4 4 0 0 0-4 4v2H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1V6a4 4 0 0 0-4-4Zm-2 6V6a2 2 0 1 1 4 0v2H8Z" />
    </svg>
  );
}
