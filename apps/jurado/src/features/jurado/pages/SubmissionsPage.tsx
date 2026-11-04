import { Link } from 'react-router';
import { StatusChip } from '../components/StatusChip';
import { useOnline } from '../hooks/useNetworkStatus';
import { useJurorStatus } from '../hooks/useJurorStatus';
import { useOutbox } from '../outbox/useOutbox';
import type { OutboxEntry } from '../outbox/outboxStore';
import { describeEntry } from '../status';

const timeFormat = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function PhotoLine({ entry }: { entry: OutboxEntry }) {
  if (entry.state !== 'DELIVERED') return null;
  const text = { PENDING: 'Foto: subiendo…', UPLOADED: 'Foto: recibida ✓', SKIPPED: 'Foto: no requerida' }[entry.photoState];
  return <p className="mt-1 text-sm text-tinta-suave">{text}</p>;
}

export default function SubmissionsPage() {
  const online = useOnline();
  const { entries } = useOutbox();
  const { actas: serverActas, lastCheckedAt } = useJurorStatus();
  const latestVersion = Math.max(0, ...entries.map((entry) => entry.submission.version));

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-rejilla bg-hoja p-6 text-center">
        <p className="text-tinta-suave">Aún no has transmitido el acta de tu mesa.</p>
        <Link to="/jurado" className="mt-4 inline-block rounded-xl bg-indeleble px-4 py-2.5 font-semibold text-white dark:text-papel">
          Llenar el acta
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const server = serverActas?.find((state) => state.actaId === entry.submission.actaId);
        const view = describeEntry(entry, online, server);
        const { receipt } = entry;
        const canCorrect = entry.submission.version === latestVersion && entry.state !== 'QUEUED' && entry.state !== 'SENDING';
        return (
          <article key={entry.idempotencyKey} className="rounded-xl border border-rejilla bg-hoja p-4">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold tracking-tight">
                Versión {entry.submission.version}
                <span className="ml-2 font-mono text-xs font-normal text-tinta-suave">{entry.submission.actaId}</span>
              </h2>
              <StatusChip view={view} />
            </header>
            {view.detail && <p className="mt-2 text-sm">{view.detail}</p>}
            <PhotoLine entry={entry} />

            {receipt && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-rejilla bg-papel p-3 text-sm">
                <dt className="text-tinta-suave">Comprobante</dt>
                <dd className="truncate font-mono text-xs leading-5">{receipt.receiptId ?? '—'}</dd>
                <dt className="text-tinta-suave">Registrada</dt>
                <dd>{receipt.registeredAt ? timeFormat.format(receipt.registeredAt) : '—'}</dd>
                <dt className="text-tinta-suave">Atendida por</dt>
                <dd className="font-mono">{receipt.instance}</dd>
              </dl>
            )}
            {!receipt && entry.attempts > 0 && (
              <p className="mt-2 text-sm text-tinta-suave">Intentos: {entry.attempts}</p>
            )}

            {canCorrect && (
              <Link
                to={`/jurado?from=${encodeURIComponent(entry.idempotencyKey)}`}
                className="mt-3 inline-block rounded-lg px-3 py-1.5 text-sm font-semibold text-indeleble ring-1 ring-indeleble/30 hover:bg-indeleble-claro"
              >
                Corregir (crea versión {latestVersion + 1})
              </Link>
            )}
          </article>
        );
      })}
      {lastCheckedAt && (
        <p className="text-center text-xs text-tinta-suave">Estado del servidor consultado a las {timeFormat.format(lastCheckedAt)}</p>
      )}
    </div>
  );
}
