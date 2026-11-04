import { useOnline } from '../hooks/useNetworkStatus';
import { useOutbox } from '../outbox/useOutbox';

/** Always-visible connection and queue indicator. */
export function NetworkBanner() {
  const online = useOnline();
  const { entries, outbox } = useOutbox();
  const pending = entries.filter((entry) => entry.state === 'QUEUED' || entry.state === 'SENDING').length;
  const notRegistered = entries.some((entry) => entry.state === 'QUEUED' && entry.lastError === 'NOT_REGISTERED');

  if (online && pending === 0) {
    return (
      <div className="flex items-center gap-2 bg-registrada px-4 py-1.5 text-sm font-medium text-white dark:text-papel" role="status">
        <span className="size-2 rounded-full bg-white" aria-hidden /> En línea
      </div>
    );
  }
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm font-medium ${online ? 'bg-indeleble text-white dark:text-papel' : 'bg-tinta text-papel'}`}
      role="status"
    >
      <span>
        {online ? 'En línea' : 'Sin conexión'}
        {pending > 0 && ` · ${pending} ${pending === 1 ? 'acta' : 'actas'} en cola`}
        {notRegistered && ' · servidor no disponible, se reintentará sola'}
      </span>
      {online && pending > 0 && (
        <button type="button" onClick={() => void outbox.retryNow()} className="rounded bg-white/15 px-2 py-0.5 font-medium hover:bg-white/25">
          Reintentar ahora
        </button>
      )}
    </div>
  );
}
