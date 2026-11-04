/**
 * Lectura del stream `ev:all` que escribe `apply_acta.lua` (servicio de actas).
 *
 * Cada entrada corresponde a UNA acta y trae, en `abs`, los valores absolutos
 * nuevos de los campos que cambiaron en cada tópico público:
 *
 *   acta, version, type (APPLIED | CORRECTION | REVERSAL), reason, tsRx,
 *   table, station, mun,
 *   abs = { "station:176": { C1: 10234, _reported: 3, _voters: 912 }, "mun:11": {...}, "dep": {...} }
 *
 * Como son valores absolutos, fusionar varios eventos es "el último gana" y
 * aplicar dos veces el mismo valor es inofensivo.
 */

/** Tipo de evento de actas → motivo legible para el público. */
const MOTIVO_POR_TIPO = Object.freeze({
  CORRECTION: 'CORRECCION',
  REVERSAL: 'EN_VERIFICACION',
});

/** @param {string[]} campos lista plana [k1, v1, k2, v2, ...] de ioredis */
function aObjeto(campos) {
  const salida = {};
  for (let i = 0; i < campos.length; i += 2) salida[campos[i]] = campos[i + 1];
  return salida;
}

/**
 * @param {[string, string[]]} entrada `[id, campos]` tal como la devuelven XREAD / XRANGE
 * @returns {{ id: string, tsRx: number, porTopico: Record<string, Record<string, number>>,
 *             motivo: { acta: string, tipo: string } | null }}
 */
export function parsearEvento([id, campos]) {
  const fila = aObjeto(campos);
  let porTopico = {};
  try {
    porTopico = JSON.parse(fila.abs ?? '{}') ?? {};
  } catch {
    porTopico = {};
  }
  const tipo = MOTIVO_POR_TIPO[fila.type];
  return {
    id,
    tsRx: Number(fila.tsRx) || Number(id.split('-')[0]),
    porTopico,
    motivo: tipo ? { acta: fila.acta, tipo } : null,
  };
}

/** Compara ids de stream `ms-seq`. Negativo si a < b. */
export function compararId(a = '0-0', b = '0-0') {
  const [am, as] = a.split('-').map(Number);
  const [bm, bs] = b.split('-').map(Number);
  return am === bm ? as - bs : am - bm;
}

const PATRON_TOPICO = /^(dep|mun:\d{1,4}|station:\d{1,5})$/;

export function esTopicoValido(topico) {
  return PATRON_TOPICO.test(topico);
}
