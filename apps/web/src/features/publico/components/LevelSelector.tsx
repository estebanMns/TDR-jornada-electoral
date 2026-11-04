import { useNavigate } from 'react-router';
import type { TopicId } from '@electoral/shared';
import { publicCatalog } from '../catalog/publicCatalog';

const selectClass =
  'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

/** Department → municipality → station, from the bundled catalog (no backend call). */
export function LevelSelector({ topic }: { topic: TopicId }) {
  const navigate = useNavigate();
  const [level, raw] = topic.split(':');
  const station = level === 'station' ? publicCatalog.station(Number(raw)) : undefined;
  const municipalityId = level === 'mun' ? Number(raw) : station?.municipalityId;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">
        Municipio
        <select
          className={`mt-1 ${selectClass}`}
          value={municipalityId ?? ''}
          onChange={(e) => navigate(e.target.value ? `/resultados/municipio/${e.target.value}` : '/resultados')}
        >
          <option value="">Todo el departamento</option>
          {publicCatalog.municipalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        Puesto de votación
        <select
          className={`mt-1 ${selectClass}`}
          value={station?.id ?? ''}
          disabled={municipalityId === undefined}
          onChange={(e) =>
            navigate(e.target.value ? `/resultados/puesto/${e.target.value}` : `/resultados/municipio/${municipalityId}`)
          }
        >
          <option value="">Todos los puestos</option>
          {municipalityId !== undefined &&
            publicCatalog.stationsOf(municipalityId).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
