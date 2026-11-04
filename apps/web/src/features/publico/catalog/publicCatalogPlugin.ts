/**
 * Vite plugin: `virtual:public-catalog` = the catalog WITHOUT its 6.400 tables
 * (~70 KB instead of 644 KB). The public page needs municipalities, stations
 * and vote options only; table counts come from the server snapshot.
 */
import type { Plugin } from 'vite';
import catalog from '@electoral/shared/catalog.json';
import type { Catalog } from '@electoral/shared';
import type { PublicCatalogData } from './publicCatalog';

const VIRTUAL_ID = 'virtual:public-catalog';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export function publicCatalogPlugin(): Plugin {
  return {
    name: 'electoral-public-catalog',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const full = catalog as unknown as Catalog;
      const slim: PublicCatalogData = {
        department: full.department,
        municipalities: full.municipalities,
        stations: full.stations.map((s) => [s.id, s.municipalityId, s.name]),
        voteOptions: full.voteOptions,
      };
      return `export default ${JSON.stringify(slim)};`;
    },
  };
}
