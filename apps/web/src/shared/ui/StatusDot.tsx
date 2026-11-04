import { cn } from './cn';

export type LiveStatus = 'live' | 'connecting' | 'reconnecting' | 'paused';

const STATUS: Record<LiveStatus, { label: string; dot: string; pulse: boolean }> = {
  live: { label: 'En vivo', dot: 'bg-success', pulse: true },
  connecting: { label: 'Conectando…', dot: 'bg-warning', pulse: false },
  reconnecting: { label: 'Reconectando…', dot: 'bg-warning', pulse: false },
  paused: { label: 'Pausado', dot: 'bg-danger', pulse: false },
};

/** Live indicator: always tells the user whether numbers are moving (RF-10). */
export function StatusDot({ status }: { status: LiveStatus }) {
  const { label, dot, pulse } = STATUS[status];
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm font-medium text-ink-soft">
      <span className="relative flex size-2.5">
        {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', dot)} />}
        <span className={cn('relative inline-flex size-2.5 rounded-full', dot)} />
      </span>
      {label}
    </span>
  );
}
