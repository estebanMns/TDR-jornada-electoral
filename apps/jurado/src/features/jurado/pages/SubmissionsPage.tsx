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
  return <p className="text-sm text-slate-500">{text}</p>;
}

export default function SubmissionsPage() {
  const online = useOnline();
  const { entries } = useOutbox();
  const { actas: serverActas, lastCheckedAt } = useJurorStatus();
  const latestVersion = Math.max(0, ...entries.map((entry) => entry.submission.version));

  if (entries.length === 0) {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-slate-600">Aún no has transmitido el acta de tu mesa.</p>
        <Link to="/jurado" className="mt-4 inline-block rounded-lg bg-blue-700 px-4 py-2 font-medium text-white">
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
          <article key={entry.idempotencyKey} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                Versión {entry.submission.version}
                <span className="ml-2 font-mono text-xs font-normal text-slate-500">{entry.submission.actaId}</span>
              </h2>
              <StatusChip view={view} />
            </header>
            {view.detail && <p className="mt-2 text-sm text-slate-700">{view.detail}</p>}
            <PhotoLine entry={entry} />

            {receipt && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
                <dt className="text-slate-500">Comprobante</dt>
                <dd className="truncate font-mono text-xs leading-5">{receipt.receiptId ?? '—'}</dd>
                <dt className="text-slate-500">Registrada</dt>
                <dd>{receipt.registeredAt ? timeFormat.format(receipt.registeredAt) : '—'}</dd>
                <dt className="text-slate-500">Atendida por</dt>
                <dd>{receipt.instance}</dd>
              </dl>
            )}
            {!receipt && entry.attempts > 0 && (
              <p className="mt-2 text-sm text-slate-500">Intentos: {entry.attempts}</p>
            )}

            {canCorrect && (
              <Link
                to={`/jurado?from=${encodeURIComponent(entry.idempotencyKey)}`}
                className="mt-3 inline-block rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
              >
                Corregir (crea versión {latestVersion + 1})
              </Link>
            )}
          </article>
        );
      })}
      {lastCheckedAt && (
        <p className="text-center text-xs text-slate-500">Estado del servidor consultado a las {timeFormat.format(lastCheckedAt)}</p>
      )}
    </div>
  );
}
