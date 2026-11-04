import { useId } from 'react';

interface CountFieldProps {
  label: string;
  hint?: string;
  color?: string;
  value: string;
  onChange: (value: string) => void;
}

/** Large numeric field for thumbs on a small screen. Accepts digits only. */
export function CountField({ label, hint, color, value, onChange }: CountFieldProps) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-rejilla bg-hoja p-3">
      {color && <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {hint && <span className="block truncate text-sm text-tinta-suave">{hint}</span>}
      </label>
      <input
        id={id}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 5))}
        className="w-24 rounded-lg border border-rejilla bg-papel px-3 py-2 text-right font-mono text-2xl tabular-nums focus:border-indeleble focus:outline-none focus:ring-2 focus:ring-indeleble/20"
      />
    </div>
  );
}
