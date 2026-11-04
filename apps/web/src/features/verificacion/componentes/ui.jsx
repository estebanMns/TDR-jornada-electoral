/**
 * Primitivas visuales mínimas de la consola. Cuando `shared/ui` (Evelyn) esté en
 * main se reemplazan por sus Button/Badge/Card sin tocar el resto de componentes.
 */

const VARIANTES_BOTON = {
  primario: 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900',
  exito: 'bg-emerald-600 text-white hover:bg-emerald-500',
  peligro: 'bg-red-600 text-white hover:bg-red-500',
  borde: 'border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800',
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
  neutro: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  verde: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  ambar: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  rojo: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
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
      className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}
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
