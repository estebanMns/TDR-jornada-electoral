/**
 * Genera `src/features/publico/catalogo-publico.json`: solo lo que necesita la
 * página pública (nombres de municipios, puestos y candidatos), sin las 6.400
 * mesas, para que el bundle del teléfono sea pequeño (RT-9).
 *
 *   node scripts/generar-catalogo-publico.js
 */
import { readFileSync, writeFileSync } from 'node:fs';

const origen = new URL('../../../packages/contracts/catalog.json', import.meta.url);
const destino = new URL('../src/features/publico/catalogo-publico.json', import.meta.url);
const catalogo = JSON.parse(readFileSync(origen, 'utf8'));

const publico = {
  departamento: catalogo.department.name,
  municipios: catalogo.municipalities.map(({ id, name }) => [id, name]),
  puestos: catalogo.stations.map(({ id, municipalityId, name }) => [id, municipalityId, name]),
  opciones: catalogo.voteOptions.map(({ id, name, party, color }) => ({ id, nombre: name, partido: party, color })),
};
writeFileSync(destino, `${JSON.stringify(publico)}\n`);
console.log(`catálogo público: ${publico.municipios.length} municipios, ${publico.puestos.length} puestos`);
