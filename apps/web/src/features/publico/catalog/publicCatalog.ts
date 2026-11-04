import data from 'virtual:public-catalog';
import type { CatalogMunicipality, CatalogStation, CatalogVoteOption, TopicId } from '@electoral/shared';

/** Compact form generated at build time (stations as tuples to save bytes). */
export interface PublicCatalogData {
  department: { id: number; name: string };
  municipalities: CatalogMunicipality[];
  stations: [id: number, municipalityId: number, name: string][];
  voteOptions: CatalogVoteOption[];
}

const stations: CatalogStation[] = data.stations.map(([id, municipalityId, name]) => ({ id, municipalityId, name }));
const municipalityById = new Map(data.municipalities.map((m) => [m.id, m]));
const stationById = new Map(stations.map((s) => [s.id, s]));

export const publicCatalog = {
  department: data.department,
  municipalities: data.municipalities,
  voteOptions: data.voteOptions,
  municipality: (id: number) => municipalityById.get(id),
  station: (id: number) => stationById.get(id),
  stationsOf: (municipalityId: number) => stations.filter((s) => s.municipalityId === municipalityId),
};

/** Human name of a topic: "San Rafael", "Coliseo … (San Rafael)". */
export function topicName(topic: TopicId): string {
  if (topic === 'dep') return data.department.name;
  const [level, raw] = topic.split(':');
  const id = Number(raw);
  if (level === 'mun') return municipalityById.get(id)?.name ?? `Municipio ${id}`;
  const station = stationById.get(id);
  if (!station) return `Puesto ${id}`;
  return `${station.name} (${municipalityById.get(station.municipalityId)?.name ?? ''})`;
}
