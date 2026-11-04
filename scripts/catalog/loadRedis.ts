import type { Redis } from 'ioredis';
import { redisKeys, type Catalog } from '@preconteo/contracts';

const PIPELINE_CHUNK = 1_000;

/**
 * Loads the catalog lookups used on the hot path:
 * - `cat:table:{id}` HASH: station, mun, enabled, actaId
 * - `cat:n:station:{id}`, `cat:n:mun:{id}`, `cat:n:dep`: number of tables (for % reported)
 */
export async function loadCatalogIntoRedis(redis: Redis, catalog: Catalog): Promise<void> {
  const municipalityByStation = new Map(catalog.stations.map((s) => [s.id, s.municipalityId]));
  const tablesPerStation = new Map<number, number>();
  const tablesPerMunicipality = new Map<number, number>();

  for (let start = 0; start < catalog.tables.length; start += PIPELINE_CHUNK) {
    const pipeline = redis.pipeline();
    for (const table of catalog.tables.slice(start, start + PIPELINE_CHUNK)) {
      const municipalityId = municipalityByStation.get(table.stationId);
      if (municipalityId === undefined) throw new Error(`Table ${table.id} has an unknown station`);
      pipeline.hset(redisKeys.catalogTable(table.id), {
        station: table.stationId,
        mun: municipalityId,
        enabled: table.enabled,
        actaId: table.actaId,
      });
      tablesPerStation.set(table.stationId, (tablesPerStation.get(table.stationId) ?? 0) + 1);
      tablesPerMunicipality.set(municipalityId, (tablesPerMunicipality.get(municipalityId) ?? 0) + 1);
    }
    await pipeline.exec();
  }

  const counts = redis.pipeline();
  for (const [stationId, count] of tablesPerStation) {
    counts.set(redisKeys.catalogStationTableCount(stationId), count);
  }
  for (const [municipalityId, count] of tablesPerMunicipality) {
    counts.set(redisKeys.catalogMunicipalityTableCount(municipalityId), count);
  }
  counts.set(redisKeys.catalogDepartmentTableCount(), catalog.tables.length);
  await counts.exec();
}
