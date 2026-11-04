'use client';

import { useEffect, useMemo, useState } from 'react';
import { useResultados } from './useResultados';
import { reportarInp } from './reportarInp';
import {
  BarraPublica,
  Tarjeta,
  Rotulo,
  PuntoEstado,
  Dato,
  BarraProgreso,
  MapaMesas,
  formatoNumero,
  formatoPorcentaje,
} from '@/shared/ui';

const CANDIDATOS = ['C1', 'C2', 'C3', 'C4', 'C5'];
const ESPECIALES = ['BLANK', 'NULL', 'UNMARKED'];

const MOTIVOS = {
  CORRECCION: 'se aplicó la corrección de un acta',
  EN_VERIFICACION: 'un acta pasó a revisión y se descontó mientras un auditor la verifica',
};

const selectorClases =
  'mt-1.5 block w-full rounded-lg border border-rejilla bg-papel px-3 py-2.5 text-base disabled:opacity-50';

/** Página pública de resultados en vivo (RF-3, RF-6; RT-9). */
export default function ResultadosPage() {
  const [catalogo, setCatalogo] = useState(null);
  const [municipio, setMunicipio] = useState('');
  const [puesto, setPuesto] = useState('');
  const [urlLeida, setUrlLeida] = useState(false);

  useEffect(() => {
    // El catálogo va en su propio chunk: no bloquea el primer render.
    import('./catalogo-publico.json').then((m) => setCatalogo(m.default));
    if (!urlLeida) {
      const params = new URLSearchParams(window.location.search);
      setMunicipio(params.get('municipio') ?? '');
      setPuesto(params.get('puesto') ?? '');
      setUrlLeida(true);
    }
    reportarInp();
  }, [urlLeida]);

  useEffect(() => {
    if (!urlLeida) return; // no borrar el filtro de la URL antes de leerlo
    const params = new URLSearchParams();
    if (municipio) params.set('municipio', municipio);
    if (puesto) params.set('puesto', puesto);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, [municipio, puesto, urlLeida]);

  // Hasta leer la URL no se abre ninguna conexión (evita una conexión de más a `dep`).
  const topico = !urlLeida ? null : puesto ? `station:${puesto}` : municipio ? `mun:${municipio}` : 'dep';
  const { valores, mesas, actualizado, estado, aviso } = useResultados(topico);

  const opciones = useMemo(() => new Map((catalogo?.opciones ?? []).map((o) => [o.id, o])), [catalogo]);
  const puestosDelMunicipio = useMemo(
    () => (catalogo?.puestos ?? []).filter(([, mun]) => String(mun) === municipio),
    [catalogo, municipio],
  );
  const nombreMunicipio = catalogo?.municipios.find(([id]) => String(id) === municipio)?.[1];
  const nombrePuesto = puestosDelMunicipio.find(([id]) => String(id) === puesto)?.[2];
  const nivel = puesto ? 'Puesto de votación' : municipio ? 'Municipio' : 'Departamento';
  const nombreNivel = puesto
    ? (nombrePuesto ?? `Puesto ${puesto}`)
    : municipio
      ? (nombreMunicipio ?? `Municipio ${municipio}`)
      : (catalogo?.departamento ?? 'Departamento');

  const votosValidos = CANDIDATOS.reduce((n, id) => n + (valores[id] ?? 0), 0) + (valores.BLANK ?? 0);
  const ranking = CANDIDATOS.map((id) => ({ id, votos: valores[id] ?? 0 })).sort((a, b) => b.votos - a.votos);
  const pctInformadas = mesas.total ? (mesas.informadas / mesas.total) * 100 : 0;

  return (
    <>
      <BarraPublica derecha={<PuntoEstado estado={estado} />} />

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:py-8">
        <div>
          <Rotulo>
            {nivel}
            {puesto && nombreMunicipio ? ` · ${nombreMunicipio}` : ''}
          </Rotulo>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{nombreNivel}</h1>
        </div>

        <Tarjeta className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Municipio
            <select
              className={selectorClases}
              value={municipio}
              onChange={(e) => {
                setMunicipio(e.target.value);
                setPuesto('');
              }}
            >
              <option value="">Todo el departamento</option>
              {catalogo?.municipios.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Puesto de votación
            <select
              className={selectorClases}
              value={puesto}
              disabled={!municipio}
              onChange={(e) => setPuesto(e.target.value)}
            >
              <option value="">{municipio ? 'Todos los puestos' : 'Elige primero un municipio'}</option>
              {puestosDelMunicipio.map(([id, , nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
        </Tarjeta>

        {aviso && (
          <p role="alert" className="rounded-xl border border-revision/40 bg-hoja p-4 text-sm">
            <strong className="text-revision">Un valor bajó</strong> porque {MOTIVOS[aviso.tipo] ?? 'se corrigió un acta'}
            {aviso.acta ? (
              <>
                {' '}
                (acta <span className="font-mono">{aviso.acta}</span>)
              </>
            ) : null}
            .
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Tarjeta>
            <div className="flex items-baseline justify-between gap-3">
              <Rotulo>Mesas informadas</Rotulo>
              <span className="font-mono text-sm text-tinta-suave">{formatoPorcentaje(pctInformadas)}</span>
            </div>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums tracking-tight">
              {formatoNumero(mesas.informadas)}
              <span className="ml-2 text-base font-normal text-tinta-suave">de {formatoNumero(mesas.total)}</span>
            </p>
            {mesas.total > 0 && <MapaMesas total={mesas.total} informadas={mesas.informadas} altoMax={220} className="mt-4" />}
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-rejilla pt-4">
              <Dato etiqueta="Votos válidos" valor={formatoNumero(votosValidos)} />
              <Dato
                etiqueta="Actualizado"
                valor={actualizado ? new Date(actualizado).toLocaleTimeString('es-CO', { timeStyle: 'short' }) : '—'}
                detalle={estado === 'pausado' ? 'último dato recibido' : 'cada 2 s'}
              />
            </div>
          </Tarjeta>

          <Tarjeta>
            <Rotulo>Candidatos</Rotulo>
            <ol className="mt-4 space-y-5">
              {ranking.map(({ id, votos }, posicion) => {
                const opcion = opciones.get(id);
                const pct = votosValidos ? (votos / votosValidos) * 100 : 0;
                return (
                  <li key={id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0">
                        <span className="mr-2 font-mono text-sm text-tinta-suave">{posicion + 1}.</span>
                        <span className="font-semibold">{opcion?.nombre ?? id}</span>
                        <span className="mt-0.5 block pl-6 text-sm text-tinta-suave">{opcion?.partido}</span>
                      </p>
                      <p className="shrink-0 text-right">
                        <span className="font-display text-xl font-bold tabular-nums">{formatoPorcentaje(pct)}</span>
                        <span className="block font-mono text-xs text-tinta-suave">{formatoNumero(votos)} votos</span>
                      </p>
                    </div>
                    <div className="mt-2">
                      <BarraProgreso porcentaje={pct} color={opcion?.color} alto="h-2" />
                    </div>
                  </li>
                );
              })}
            </ol>
            <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-rejilla pt-4">
              {ESPECIALES.map((id) => (
                <div key={id}>
                  <dt className="text-xs text-tinta-suave">{opciones.get(id)?.nombre ?? id}</dt>
                  <dd className="mt-0.5 font-mono text-lg font-medium tabular-nums">{formatoNumero(valores[id])}</dd>
                </div>
              ))}
            </dl>
          </Tarjeta>
        </div>

        <p className="text-center text-xs text-tinta-suave">
          Preconteo informativo. El resultado oficial es el escrutinio de las actas físicas.
        </p>
      </main>
    </>
  );
}
