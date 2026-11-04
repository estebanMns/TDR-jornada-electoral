'use client';

import { useEffect, useRef, useState } from 'react';
import { conectarSse } from '@/shared/net/sse';
import { Tarjeta, PuntoEstado, Dato, formatoNumero } from '@/shared/ui';

const PUNTOS = 90; // 3 minutos a 2 s por punto

const mb = (bytes) => `${(Number(bytes ?? 0) / 1024 / 1024).toFixed(0)} MB`;
const kb = (bytes) => `${(Number(bytes ?? 0) / 1024).toFixed(1)} KB`;
const ms = (v) => (v == null ? '—' : `${Number(v).toFixed(1)} ms`);

/** Mini gráfica de línea en SVG (sin librerías). */
function Serie({ titulo, puntos, unidad = '', color = '#7c3aed' }) {
  const max = Math.max(1, ...puntos);
  const camino = puntos
    .map((v, i) => `${(i / Math.max(1, PUNTOS - 1)) * 100},${30 - (v / max) * 28}`)
    .join(' ');
  const ultimo = puntos.at(-1) ?? 0;
  return (
    <Tarjeta>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <span className="text-sm tabular-nums text-slate-500">
          {formatoNumero(Math.round(ultimo * 10) / 10)} {unidad}
        </span>
      </div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-3 h-20 w-full">
        <polyline points={camino} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-right text-xs text-slate-400">máx. {formatoNumero(Math.round(max))}</p>
    </Tarjeta>
  );
}

/** Tablero de operación (RT-7). Datos: `GET /api/ops/stream` (ADMIN), cada 2 s. */
export default function OpsPage() {
  const [datos, setDatos] = useState(null);
  const [estado, setEstado] = useState('reconectando');
  const historia = useRef({ mensajes: [], eventLoop: [], latencia: [], reconexiones: [] });
  const [, refrescar] = useState(0);

  useEffect(
    () =>
      conectarSse({
        url: '/api/ops/stream',
        alEstado: setEstado,
        alMensaje: ({ evento, datos: d }) => {
          if (evento === 'estado') setEstado(d?.redis === 'degradado' ? 'pausado' : 'en_vivo');
          if (evento !== 'metricas') return;
          const t = d.totales ?? {};
          const latencias = d.instancias.map((i) => i.histogramas?.publico_latencia_ms?.p99 ?? 0);
          const h = historia.current;
          const empujar = (serie, v) => {
            serie.push(Number(v) || 0);
            if (serie.length > PUNTOS) serie.shift();
          };
          empujar(h.mensajes, t.porSeg?.publico_mensajes_reales);
          empujar(h.eventLoop, t.eventLoopP99MaxMs);
          empujar(h.latencia, Math.max(0, ...latencias));
          empujar(h.reconexiones, t.porSeg?.publico_reconexiones);
          setDatos(d);
          refrescar((n) => n + 1);
        },
      }),
    [],
  );

  const instancias = datos?.instancias ?? [];
  const t = datos?.totales ?? {};
  const reales = t.total?.publico_mensajes_reales ?? 0;
  const ingenuos = t.total?.publico_mensajes_ingenuos ?? 0;
  // Cada instancia lee todos los eventos de ev:all: se toma una, no la suma.
  const actasPorMin = (instancias[0]?.contadores?.publico_eventos?.porSeg ?? 0) * 60;
  const inp = Math.max(0, ...instancias.map((i) => i.gauges?.inp_p75_ms ?? 0)) || null;
  const h = historia.current;

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Operación</h1>
        <PuntoEstado estado={estado} />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta>
          <Dato etiqueta="Instancias reportando" valor={t.instancias ?? 0} />
        </Tarjeta>
        <Tarjeta>
          <Dato
            etiqueta="Conexiones"
            valor={formatoNumero((t.conexiones?.sse ?? 0) + (t.conexiones?.ws ?? 0))}
            detalle={`${formatoNumero(t.conexiones?.sse)} SSE · ${formatoNumero(t.conexiones?.ws)} WS`}
          />
        </Tarjeta>
        <Tarjeta>
          <Dato etiqueta="Actas aplicadas / min" valor={formatoNumero(Math.round(actasPorMin))} />
        </Tarjeta>
        <Tarjeta>
          <Dato etiqueta="INP p75 (público)" valor={ms(inp)} detalle="medido en los navegadores" />
        </Tarjeta>
      </div>

      <Tarjeta className="grid gap-4 sm:grid-cols-3">
        <Dato etiqueta="Mensajes emitidos (real)" valor={formatoNumero(reales)} />
        <Dato etiqueta="Cifra ingenua (actas × clientes)" valor={formatoNumero(ingenuos)} />
        <Dato
          etiqueta="Reducción"
          valor={reales ? `${formatoNumero(Math.round(ingenuos / reales))}×` : '—'}
          detalle="ventanas de 2 s + suscripción por tópico"
        />
      </Tarjeta>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Serie titulo="Mensajes / s" puntos={h.mensajes} />
        <Serie titulo="Event Loop p99 (peor instancia)" puntos={h.eventLoop} unidad="ms" color="#dc2626" />
        <Serie titulo="Latencia recepción → publicación p99" puntos={h.latencia} unidad="ms" color="#0891b2" />
        <Serie titulo="Reconexiones / s" puntos={h.reconexiones} color="#d97706" />
      </div>

      <Tarjeta className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
            <tr>
              {['Instancia', 'SSE', 'WS', 'Msg/s', 'Event Loop p50 / p99 / máx', 'Memoria', 'Memoria por conexión'].map((c) => (
                <th key={c} className="px-4 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {instancias.map((i) => {
              const conexiones = (i.gauges?.conexiones?.sse ?? 0) + (i.gauges?.conexiones?.ws ?? 0);
              const el = i.gauges?.event_loop_ms ?? {};
              return (
                <tr key={i.instancia} className="border-t border-slate-100 tabular-nums dark:border-slate-800">
                  <td className="px-4 py-2 font-semibold">{i.instancia}</td>
                  <td className="px-4 py-2">{formatoNumero(i.gauges?.conexiones?.sse)}</td>
                  <td className="px-4 py-2">{formatoNumero(i.gauges?.conexiones?.ws)}</td>
                  <td className="px-4 py-2">{(i.contadores?.publico_mensajes_reales?.porSeg ?? 0).toFixed(1)}</td>
                  <td className="px-4 py-2">
                    {el.p50 ?? '—'} / {el.p99 ?? '—'} / {el.max ?? '—'} ms
                  </td>
                  <td className="px-4 py-2">{mb(i.gauges?.memoria?.rss)}</td>
                  <td className="px-4 py-2">{conexiones ? kb(i.gauges?.memoria?.heapUsed / conexiones) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!datos && <p className="p-4 text-sm text-slate-500">Esperando métricas…</p>}
      </Tarjeta>
    </main>
  );
}
