import { useEffect } from 'react';
import { useParams } from 'react-router';
import type { TopicId } from '@electoral/shared';
import { Card, PageShell, Stat, StatusDot } from '../../shared/ui';
import { publicCatalog, topicName } from './catalog/publicCatalog';
import { CorrectionNotice } from './components/CorrectionNotice';
import { LevelSelector } from './components/LevelSelector';
import { Ranking } from './components/Ranking';
import { usePublicResults } from './state/usePublicResults';
import { reportInp } from './vitals';

/** `/resultados`, `/resultados/municipio/:id`, `/resultados/puesto/:id` → topic. */
function topicFromParams(level?: string, rawId?: string): TopicId {
  const id = Number(rawId);
  if (level === 'municipio' && publicCatalog.municipality(id)) return `mun:${id}`;
  if (level === 'puesto' && publicCatalog.station(id)) return `station:${id}`;
  return 'dep';
}

const formatTime = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString('es-CO', { hour12: false }) : '—');

export default function ResultsPage() {
  const { level, id } = useParams();
  const topic = topicFromParams(level, id);
  const { status, topics } = usePublicResults([topic]);
  const results = topics[topic];

  useEffect(() => {
    void reportInp();
  }, []);

  const reported = results?.totals._reported ?? 0;
  const total = results?.tablesTotal ?? 0;
  const reportedShare = total > 0 ? (reported / total) * 100 : 0;

  return (
    <PageShell title={topicName(topic)} subtitle="Resultados preliminares en tiempo real" actions={<StatusDot status={status} />}>
      <Card>
        <LevelSelector topic={topic} />
      </Card>

      {status === 'paused' && (
        <p role="status" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          Actualizaciones pausadas: se muestra el último dato recibido ({formatTime(results?.updatedAt ?? null)}).
        </p>
      )}
      {results?.notice && <CorrectionNotice notice={results.notice} />}

      <Card className="grid grid-cols-3 gap-4">
        <Stat
          label="Mesas informadas"
          value={`${reportedShare.toFixed(1)}%`}
          hint={`${reported.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')}`}
        />
        <Stat label="Votantes" value={(results?.totals._voters ?? 0).toLocaleString('es-CO')} />
        <Stat label="Último dato" value={formatTime(results?.updatedAt ?? null)} />
      </Card>

      <Card>
        {results ? <Ranking totals={results.totals} /> : <p className="py-10 text-center text-ink-soft">Cargando resultados…</p>}
      </Card>
    </PageShell>
  );
}
