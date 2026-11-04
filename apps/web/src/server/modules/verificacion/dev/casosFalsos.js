import { redisKeys } from '@preconteo/shared';
import {
  casoVerificacionSchema,
  scoreDeCaso,
  MensajeServidor,
} from '@preconteo/shared/schemas/verificacion';

/**
 * Encola un caso dudoso con EL MISMO formato que usará Jose
 * (`verif:case:{acta}` + `verif:queue`) y avisa por `ch:verif`.
 * Solo para desarrollo y pruebas: permite trabajar sin el módulo de actas.
 * @param {import('ioredis').Redis} redis cliente ioredis
 */
export async function encolarCasoFalso(redis, datos) {
  const caso = casoVerificacionSchema.parse(datos);
  await redis
    .multi()
    .set(redisKeys.verificacion.caso(caso.acta), JSON.stringify(caso))
    .zadd(redisKeys.verificacion.cola, scoreDeCaso(caso), caso.acta)
    .publish(
      redisKeys.verificacion.canal,
      JSON.stringify({ tipo: MensajeServidor.CASO_NUEVO, item: caso }),
    )
    .exec();
  return caso;
}

const MOTIVOS = ['DESCUADRE', 'SUFRAGANTES_EXCEDEN', 'CONFLICTO'];
const CANDIDATOS = ['C1', 'C2', 'C3', 'C4', 'C5', 'BLANCO', 'NULO', 'NO_MARCADO'];

/** Genera un caso plausible y determinista a partir de un número. */
export function casoDeEjemplo(n, ahora = Date.now()) {
  const votos = Object.fromEntries(
    CANDIDATOS.map((c, i) => [c, ((n * 7 + i * 13) % 40) + (i < 5 ? 10 : 0)]),
  );
  const suma = Object.values(votos).reduce((a, b) => a + b, 0);
  const motivo = MOTIVOS[n % MOTIVOS.length];
  const municipio = (n % 30) + 1;
  const puesto = (n % 1842) + 1;
  return {
    acta: `E14-${String(n).padStart(5, '0')}`,
    version: 1,
    prioridad: (n % 3) + 1,
    motivo,
    mesa: n,
    puesto: { id: puesto, nombre: `Puesto ${puesto}` },
    municipio: { id: municipio, nombre: `Municipio ${municipio}` },
    votos,
    sufragantes: motivo === 'DESCUADRE' ? suma - 3 : suma,
    habilitados: motivo === 'SUFRAGANTES_EXCEDEN' ? suma - 5 : suma + 40,
    encoladaEn: ahora - n * 1000,
  };
}
