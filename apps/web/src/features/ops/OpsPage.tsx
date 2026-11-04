'use client';
import { useEffect, useState } from 'react';
import { Card, PageShell, Stat, StatusDot } from '../../shared/ui';
import { connectSse, type SseStatus } from '../../shared/net/sse';

export default function OpsPage() {
  const [data,setData]=useState<any>(null),[status,setStatus]=useState<SseStatus>('reconnecting');
  useEffect(()=>connectSse({url:'/api/ops/stream',onStatus:setStatus,onMessage:m=>{if(m.event==='metricas')setData(m.data);if(m.event==='estado'&&m.data?.redis==='degradado')setStatus('paused');}}),[]);
  const instances=data?.instancias??[], totals=data?.totales??{};
  const factor=totals.mensajesIngenuos? (totals.mensajesIngenuos/Math.max(1,totals.mensajesReales)).toFixed(1):'—';
  return <PageShell title="Operaciones">
    <Card className="flex items-center justify-between"><b>Flujo de métricas</b><StatusDot status={status}/></Card>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card><Stat label="Instancias activas" value={instances.length}/></Card>
      <Card><Stat label="Conexiones SSE" value={totals.conexiones?.sse??'—'}/></Card>
      <Card><Stat label="Conexiones WS" value={totals.conexiones?.ws??'—'}/></Card>
      <Card><Stat label="Event Loop p99 máximo" value={`${totals.eventLoopP99MaxMs??'—'} ms`}/></Card>
    </div>
    <Card><h2 className="font-semibold">Mensajes reales vs. ingenuos</h2><div className="mt-3 grid gap-4 sm:grid-cols-3"><Stat label="Reales" value={totals.mensajesReales??'—'}/><Stat label="Ingenuos" value={totals.mensajesIngenuos??'—'}/><Stat label="Factor de reducción" value={factor}/></div><p className="mt-2 text-xs text-slate-500">El backend actual de ops publica gauges y contadores agregados; los contadores del módulo público se muestran si Meneses los incorpora al contrato de métricas.</p></Card>
    <div className="grid gap-4 md:grid-cols-2">{instances.map((item:any)=><Card key={item.instancia}><h2 className="font-semibold">{item.instancia}</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div>Conexiones SSE: {item.gauges?.conexiones?.sse??0}</div><div>Conexiones WS: {item.gauges?.conexiones?.ws??0}</div><div>Mensajes/s: {Object.values(item.contadores??{}).reduce((n:any,c:any)=>n+(c.porSeg??0),0).toFixed(1)}</div><div>Event Loop p50/p99/max: {item.histogramas?.event_loop_ms?.p50??'—'} / {item.histogramas?.event_loop_ms?.p99??'—'} / {item.histogramas?.event_loop_ms?.max??'—'} ms</div><div>Memoria RSS: {item.gauges?.memoria?.rss??'—'}</div><div>Redis: {item.gauges?.redis??'—'}</div></div></Card>)}</div>
    {!data&&<p className="text-sm text-slate-500">Esperando datos de /api/ops/stream. Esta ruta está protegida por el rol ADMIN.</p>}
  </PageShell>;
}
