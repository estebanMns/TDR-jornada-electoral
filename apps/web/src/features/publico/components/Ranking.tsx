import { CANDIDATE_IDS, SPECIAL_VOTE_IDS } from '@electoral/shared';
import { BarRow } from '../../../shared/ui';
import { publicCatalog } from '../catalog/publicCatalog';

const optionById = new Map(publicCatalog.voteOptions.map((o) => [o.id, o]));

/** Candidates ordered by votes, % over every vote of the acta (CSS bars). */
export function Ranking({ totals }: { totals: Record<string, number> }) {
  const allVotes = [...CANDIDATE_IDS, ...SPECIAL_VOTE_IDS].reduce((sum, id) => sum + (totals[id] ?? 0), 0);
  const share = (votes: number) => (allVotes === 0 ? 0 : votes / allVotes);
  const candidates = [...CANDIDATE_IDS].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));

  return (
    <div>
      <ol className="divide-y divide-line">
        {candidates.map((id, position) => {
          const option = optionById.get(id)!;
          return (
            <li key={id}>
              <BarRow
                label={`${position + 1}. ${option.name}`}
                detail={option.party}
                value={totals[id] ?? 0}
                share={share(totals[id] ?? 0)}
                color={option.color}
              />
            </li>
          );
        })}
      </ol>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm">
        {SPECIAL_VOTE_IDS.map((id) => (
          <div key={id}>
            <dt className="text-ink-soft">{optionById.get(id)?.name}</dt>
            <dd className="font-medium tabular-nums">
              {(totals[id] ?? 0).toLocaleString('es-CO')} · {(share(totals[id] ?? 0) * 100).toFixed(1)}%
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
