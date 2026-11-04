import {
  buildActaId,
  type Catalog,
  type CatalogMunicipality,
  type CatalogStation,
  type CatalogTable,
  type CatalogVoteOption,
} from '@preconteo/contracts';
import { createRandom, type Random } from './random';

export interface CatalogSize {
  municipalities: number;
  stations: number;
  tables: number;
  minEnabled: number;
  maxEnabled: number;
}

/** Figures of the case study (PDF §3.2). */
export const DEFAULT_CATALOG_SIZE: CatalogSize = {
  municipalities: 30,
  stations: 1_842,
  tables: 6_400,
  minEnabled: 300,
  maxEnabled: 700,
};

export const DEFAULT_SEED = 20_261_103;

const MUNICIPALITY_NAMES = [
  'San Rafael', 'Villa del Río', 'Puerto Alegre', 'La Esperanza', 'El Carmen',
  'Santa Lucía', 'Altamira', 'Buenavista', 'Monteverde', 'Las Palmas',
  'San Jerónimo', 'El Retiro', 'La Unión', 'Bellavista', 'Río Claro',
  'Piedras Blancas', 'San Pedro', 'Valle Hermoso', 'El Rosal', 'Santa Clara',
  'Los Andes', 'La Victoria', 'Miraflores', 'San Isidro', 'El Tambo',
  'Guadalupe', 'La Florida', 'San Antonio', 'Campo Alegre', 'El Peñol',
];

const STATION_KINDS = ['I.E.', 'Colegio', 'Escuela', 'Coliseo', 'Casa de la Cultura'];

const VOTE_OPTIONS: CatalogVoteOption[] = [
  { id: 'C1', name: 'Ana María Restrepo', party: 'Movimiento Cívico', color: '#2563eb' },
  { id: 'C2', name: 'Carlos Andrés Ruiz', party: 'Partido Verde Regional', color: '#16a34a' },
  { id: 'C3', name: 'Lucía Fernanda Gómez', party: 'Alianza Social', color: '#dc2626' },
  { id: 'C4', name: 'Jorge Iván Morales', party: 'Coalición Progreso', color: '#9333ea' },
  { id: 'C5', name: 'Diana Patricia Silva', party: 'Frente Ciudadano', color: '#ea580c' },
  { id: 'BLANK', name: 'Voto en blanco', party: '—', color: '#e5e7eb' },
  { id: 'NULL', name: 'Votos nulos', party: '—', color: '#6b7280' },
  { id: 'UNMARKED', name: 'Tarjetas no marcadas', party: '—', color: '#9ca3af' },
];

/**
 * Splits `total` into `parts` positive integers following `weights`
 * (largest remainder method, so the sum is exact).
 */
function distribute(total: number, weights: number[]): number[] {
  const parts = weights.length;
  if (total < parts) throw new Error(`Cannot split ${total} into ${parts} positive parts`);
  const free = total - parts;
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (weight / weightSum) * free);
  const result = raw.map((value) => 1 + Math.floor(value));
  let missing = total - result.reduce((sum, value) => sum + value, 0);
  const byRemainder = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; missing > 0; i = (i + 1) % parts, missing--) {
    const target = byRemainder[i];
    if (target) result[target.index]! += 1;
  }
  return result;
}

/** Heavy-tailed weights: a few big municipalities (capital) and many small ones. */
function municipalityWeights(count: number, random: Random): number[] {
  return Array.from({ length: count }, (_, index) => (index === 0 ? 8 : 1 + random.next() * 3));
}

function stationWeights(count: number, random: Random): number[] {
  return Array.from({ length: count }, () => 0.5 + random.next() * 2);
}

/** Deterministic synthetic catalog: same seed → byte-identical catalog. */
export function generateCatalog(
  size: CatalogSize = DEFAULT_CATALOG_SIZE,
  seed: number = DEFAULT_SEED,
): Catalog {
  if (size.municipalities > MUNICIPALITY_NAMES.length) {
    throw new Error(`Only ${MUNICIPALITY_NAMES.length} municipality names are available`);
  }
  const random = createRandom(seed);

  const municipalities: CatalogMunicipality[] = MUNICIPALITY_NAMES.slice(0, size.municipalities).map(
    (name, index) => ({ id: index + 1, name }),
  );

  const stationsPerMunicipality = distribute(
    size.stations,
    municipalityWeights(size.municipalities, random),
  );
  const stations: CatalogStation[] = [];
  municipalities.forEach((municipality, index) => {
    const count = stationsPerMunicipality[index] ?? 0;
    for (let n = 1; n <= count; n++) {
      const kind = random.pick(STATION_KINDS);
      stations.push({
        id: stations.length + 1,
        municipalityId: municipality.id,
        name: `${kind} ${municipality.name} N.º ${n}`,
      });
    }
  });

  const tablesPerStation = distribute(size.tables, stationWeights(size.stations, random));
  const tables: CatalogTable[] = [];
  stations.forEach((station, index) => {
    const count = tablesPerStation[index] ?? 0;
    for (let number = 1; number <= count; number++) {
      tables.push({
        id: tables.length + 1,
        stationId: station.id,
        number,
        enabled: random.int(size.minEnabled, size.maxEnabled),
        actaId: buildActaId(station.id, number),
      });
    }
  });

  return {
    department: { id: 1, name: 'Departamento del Valle Central' },
    municipalities,
    stations,
    tables,
    voteOptions: VOTE_OPTIONS,
  };
}
