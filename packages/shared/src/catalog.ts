import type { VoteOptionId } from './voteOptions';

export interface CatalogMunicipality {
  id: number;
  name: string;
}

export interface CatalogStation {
  id: number;
  municipalityId: number;
  name: string;
}

export interface CatalogTable {
  /** Global table number (1..6400). */
  id: number;
  stationId: number;
  /** Table number inside its station (1..n). */
  number: number;
  /** Citizens enabled to vote at this table. */
  enabled: number;
  actaId: string;
}

export interface CatalogVoteOption {
  id: VoteOptionId;
  name: string;
  party: string;
  color: string;
}

export interface Catalog {
  department: { id: number; name: string };
  municipalities: CatalogMunicipality[];
  stations: CatalogStation[];
  tables: CatalogTable[];
  voteOptions: CatalogVoteOption[];
}

/** Only one corporation is elected (spec P-4). */
export const CORPORATION_CODE = '03';

export function buildActaId(stationId: number, tableNumber: number): string {
  return `E14-${stationId}-${String(tableNumber).padStart(4, '0')}-${CORPORATION_CODE}`;
}
