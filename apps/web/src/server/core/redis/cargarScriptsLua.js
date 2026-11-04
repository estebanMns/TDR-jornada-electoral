import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Lee scripts Lua de un directorio para registrarlos con `RedisGateway.definirScripts`.
 * @param {string} directorio
 * @param {Record<string, { archivo: string, numeroClaves: number }>} especificacion
 *        nombreComando → archivo y número de KEYS
 */
export function cargarScriptsLua(directorio, especificacion) {
  return Object.entries(especificacion).map(([nombre, { archivo, numeroClaves }]) => ({
    nombre,
    numeroClaves,
    lua: readFileSync(join(directorio, archivo), 'utf8'),
  }));
}
