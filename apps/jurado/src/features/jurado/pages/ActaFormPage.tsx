import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { sumVotes, VOTE_OPTION_IDS, type ActaSubmission, type VoteOptionId, type Votes } from '@preconteo/contracts';
import { getSession } from '../../../app/session';
import { CountField } from '../components/CountField';
import { PhotoField } from '../components/PhotoField';
import { useJurorStatus } from '../hooks/useJurorStatus';
import { useTableInfo } from '../hooks/useTableInfo';
import { outbox, useOutbox } from '../outbox/useOutbox';
import { outboxStore } from '../outbox/outboxStore';
import { sha256Hex, type PreparedPhoto } from '../photo/preparePhoto';
import { highestKnownVersion } from '../status';

type FormValues = Record<VoteOptionId | 'voters', string>;

const EMPTY_FORM = Object.fromEntries([...VOTE_OPTION_IDS, 'voters'].map((field) => [field, ''])) as FormValues;

function toNumber(value: string): number {
  return value === '' ? 0 : Number(value);
}

export default function ActaFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tableId = getSession()?.user.tableId;
  const info = useTableInfo(tableId);
  const { entries } = useOutbox();
  const { actas: serverActas } = useJurorStatus();

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // "Corregir": start from a previous transmission (same photo allowed).
  const correctionOf = searchParams.get('from');
  useEffect(() => {
    if (!correctionOf) return;
    void outboxStore.get(correctionOf).then(async (entry) => {
      if (!entry) return;
      const { votes, voters } = entry.submission;
      setValues({ ...(Object.fromEntries(VOTE_OPTION_IDS.map((id) => [id, String(votes[id])])) as FormValues), voters: String(voters) });
      setPhoto({ blob: entry.photo, hash: await sha256Hex(entry.photo) });
    });
  }, [correctionOf]);

  const votes = useMemo(
    () => Object.fromEntries(VOTE_OPTION_IDS.map((id) => [id, toNumber(values[id])])) as Votes,
    [values],
  );
  const counted = sumVotes(votes);
  const voters = toNumber(values.voters);
  const complete = Object.values(values).every((value) => value !== '') && photo !== null;

  if (info === null) return <p className="p-6 text-tinta-suave">Cargando mesa…</p>;
  if (info === 'not-found') return <p className="p-6 text-revision">Tu usuario no tiene una mesa asignada en el catálogo.</p>;

  const { table, station, municipality, voteOptions } = info;
  const version = highestKnownVersion(table.actaId, entries, serverActas) + 1;
  const isCorrection = version > 1;
  const difference = counted - voters;
  const exceedsEnabled = voters > table.enabled;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!complete || !photo || submitting) return;
    setSubmitting(true);
    const submission: ActaSubmission = {
      actaId: table.actaId,
      version,
      tableId: table.id,
      votes,
      voters,
      photoHash: photo.hash,
    };
    await outbox.enqueue(submission, photo.blob);
    navigate('/jurado/envios');
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4 pb-32">
      <section className="rounded-xl border border-rejilla bg-hoja p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-tinta-suave">Acta E-14 · {table.actaId}</p>
        <h1 className="mt-2 font-display text-xl font-bold leading-tight tracking-tight">{station.name}</h1>
        <p className="text-sm text-tinta-suave">{municipality.name}</p>
        <dl className="mt-3 grid grid-cols-3 divide-x divide-rejilla rounded-lg border border-rejilla text-center">
          <div className="p-2">
            <dt className="text-xs text-tinta-suave">Mesa</dt>
            <dd className="font-mono text-lg font-medium">{table.number}</dd>
          </div>
          <div className="p-2">
            <dt className="text-xs text-tinta-suave">Habilitados</dt>
            <dd className="font-mono text-lg font-medium tabular-nums">{table.enabled}</dd>
          </div>
          <div className="p-2">
            <dt className="text-xs text-tinta-suave">Versión</dt>
            <dd className="font-mono text-lg font-medium">{version}</dd>
          </div>
        </dl>
        {isCorrection && (
          <p className="mt-3 rounded-lg border border-revision/30 bg-revision/10 p-2 text-sm">
            Estás enviando una <strong>corrección</strong>: reemplazará la versión {version - 1}.
          </p>
        )}
      </section>

      <PhotoField photo={photo} onChange={setPhoto} />

      <section className="space-y-2" aria-label="Votos por opción">
        <p className="px-1 pt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-tinta-suave">Votos por opción</p>
        {voteOptions.map((option) => (
          <CountField
            key={option.id}
            label={option.name}
            hint={option.party !== '—' ? option.party : undefined}
            color={option.color}
            value={values[option.id]}
            onChange={(value) => setValues((current) => ({ ...current, [option.id]: value }))}
          />
        ))}
      </section>

      <CountField
        label="Total de sufragantes"
        hint="Personas que votaron en la mesa"
        value={values.voters}
        onChange={(value) => setValues((current) => ({ ...current, voters: value }))}
      />

      <div className="fixed inset-x-0 bottom-0 border-t border-rejilla bg-hoja/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <div className="mb-2 flex items-baseline justify-between text-sm" aria-live="polite">
            <span className="text-tinta-suave">
              Suma de votos <strong className="ml-1 font-mono text-base text-tinta tabular-nums">{counted}</strong>
            </span>
            <span className="text-tinta-suave">
              Sufragantes <strong className="ml-1 font-mono text-base text-tinta tabular-nums">{voters}</strong>
            </span>
          </div>
          {values.voters !== '' && difference !== 0 && (
            <p className="mb-2 rounded-lg border border-revision/30 bg-revision/10 p-2 text-sm">
              El total no cuadra ({difference > 0 ? '+' : ''}
              {difference}). Puedes transmitir: el acta irá a verificación.
            </p>
          )}
          {exceedsEnabled && (
            <p className="mb-2 rounded-lg border border-revision/30 bg-revision/10 p-2 text-sm">
              Hay más sufragantes que habilitados ({table.enabled}). El acta irá a verificación.
            </p>
          )}
          <button
            type="submit"
            disabled={!complete || submitting}
            className="w-full rounded-xl bg-indeleble py-3.5 text-lg font-semibold text-white transition hover:brightness-110 disabled:opacity-40 dark:text-papel"
          >
            {submitting ? 'Guardando…' : isCorrection ? 'Transmitir corrección' : 'Transmitir acta'}
          </button>
        </div>
      </div>
    </form>
  );
}
