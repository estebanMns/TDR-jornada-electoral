/** One candidate in the ranking: CSS bar, no chart library (RT-9). */
export function BarRow({
  label,
  detail,
  value,
  share,
  color,
}: {
  label: string;
  detail?: string;
  value: number;
  /** 0..1 */
  share: number;
  color: string;
}) {
  const percent = (share * 100).toFixed(1);
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-medium">
          {label}
          {detail && <span className="ml-2 text-sm font-normal text-ink-soft">{detail}</span>}
        </p>
        <p className="shrink-0 tabular-nums">
          <span className="font-semibold">{percent}%</span>
          <span className="ml-2 text-sm text-ink-soft">{value.toLocaleString('es-CO')}</span>
        </p>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(100, share * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
