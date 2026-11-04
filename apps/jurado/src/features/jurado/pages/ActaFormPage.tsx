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

  if (info === null) return <p className="p-6 text-slate-500">Cargando mesa…</p>;
  if (info === 'not-found') return <p className="p-6 text-red-700">Tu usuario no tiene una mesa asignada en el catálogo.</p>;

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
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">{municipality.name}</p>
        <h1 className="text-lg font-semibold">{station.name}</h1>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-slate-500">Mesa</dt>
            <dd className="font-medium">{table.number}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Habilitados</dt>
            <dd className="font-medium tabular-nums">{table.enabled}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Versión</dt>
            <dd className="font-medium">{version}</dd>
          </div>
        </dl>
        <p className="mt-2 font-mono text-xs text-slate-500">{table.actaId}</p>
        {isCorrection && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900 ring-1 ring-amber-200">
            Estás enviando una <strong>corrección</strong>: reemplazará la versión {version - 1}.
          </p>
        )}
      </section>

      <PhotoField photo={photo} onChange={setPhoto} />

      <section className="space-y-2" aria-label="Votos por opción">
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

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <div className="mb-2 flex items-baseline justify-between text-sm" aria-live="polite">
            <span>
              Suma de votos: <strong className="tabular-nums">{counted}</strong>
            </span>
            <span>
              Sufragantes: <strong className="tabular-nums">{voters}</strong>
            </span>
          </div>
          {values.voters !== '' && difference !== 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              El total no cuadra ({difference > 0 ? '+' : ''}
              {difference}). Puedes transmitir: el acta irá a verificación.
            </p>
          )}
          {exceedsEnabled && (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              Hay más sufragantes que habilitados ({table.enabled}). El acta irá a verificación.
            </p>
          )}
          <button
            type="submit"
            disabled={!complete || submitting}
            className="w-full rounded-xl bg-blue-700 py-3 text-lg font-semibold text-white disabled:bg-slate-300"
          >
            {submitting ? 'Guardando…' : isCorrection ? 'Transmitir corrección' : 'Transmitir acta'}
          </button>
        </div>
      </div>
    </form>
  );
}
