import { useEffect, useState } from 'react';
import type { Catalog, CatalogMunicipality, CatalogStation, CatalogTable, CatalogVoteOption } from '@preconteo/contracts';

export interface TableInfo {
  table: CatalogTable;
  station: CatalogStation;
  municipality: CatalogMunicipality;
  voteOptions: CatalogVoteOption[];
}

let catalogPromise: Promise<Catalog> | null = null;

/** The catalog is a separate lazy chunk, precached by the service worker for offline use. */
function loadCatalog(): Promise<Catalog> {
  catalogPromise ??= import('@preconteo/contracts/catalog.json').then((module) => module.default as Catalog);
  return catalogPromise;
}

export function useTableInfo(tableId: number | undefined): TableInfo | null | 'not-found' {
  const [info, setInfo] = useState<TableInfo | null | 'not-found'>(null);

  useEffect(() => {
    if (tableId === undefined) {
      setInfo('not-found');
      return;
    }
    let cancelled = false;
    void loadCatalog().then((catalog) => {
      if (cancelled) return;
      const table = catalog.tables.find((candidate) => candidate.id === tableId);
      const station = table && catalog.stations.find((candidate) => candidate.id === table.stationId);
      const municipality = station && catalog.municipalities.find((candidate) => candidate.id === station.municipalityId);
      setInfo(table && station && municipality ? { table, station, municipality, voteOptions: catalog.voteOptions } : 'not-found');
    });
    return () => {
      cancelled = true;
    };
  }, [tableId]);

  return info;
}
