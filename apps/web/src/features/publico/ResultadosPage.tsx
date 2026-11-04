'use client';
import { useMemo, useState } from 'react';
import catalog from '../../../../../packages/shared/catalog.json';
import { BarRow, Card, PageShell, StatusDot } from '../../shared/ui';
import { usePublicResults } from './usePublicResults';

export default function ResultadosPage() {
  const [municipality, setMunicipality] = useState('dep');
  const [station, setStation] = useState('');
  const topic = station ? `station:${station}` : municipality === 'dep' ? 'dep' : `mun:${municipality}`;
  const { rows, status, updatedAt, correction, informed } = usePublicResults(topic);
  const total = useMemo(() => rows.reduce((sum,row)=>sum+row.votes,0),[rows]);
  const options = new Map(catalog.voteOptions.map((item:any)=>[item.id,item]));
  const tables = municipality === 'dep' ? catalog.tables : catalog.tables.filter((t:any)=>catalog.stations.find((s:any)=>s.id===t.stationId)?.municipalityId===Number(municipality));
  const informedPct = tables.length ? Math.min(100,informed/tables.length*100) : 0;
  return <PageShell title="Resultados en vivo">
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Municipio <select className="ml-2 rounded border p-2 dark:bg-slate-900" value={municipality} onChange={e=>{setMunicipality(e.target.value);setStation('');}}><option value="dep">Departamento</option>{catalog.municipalities.map((m:any)=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {municipality!=='dep' && <label className="text-sm">Puesto <select className="ml-2 max-w-64 rounded border p-2 dark:bg-slate-900" value={station} onChange={e=>setStation(e.target.value)}><option value="">Todos</option>{catalog.stations.filter((s:any)=>s.municipalityId===Number(municipality)).map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      </div><StatusDot status={status}/>
    </Card>
    {correction && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{correction}</p>}
    <Card><div className="flex items-end justify-between"><div><p className="text-sm text-slate-500">Votos contabilizados</p><p className="text-3xl font-bold">{total.toLocaleString('es-CO')}</p></div><p className="text-xs text-slate-500">{updatedAt?new Date(updatedAt).toLocaleTimeString('es-CO'):'Esperando datos'}</p></div>
      <div className="mt-6 space-y-4">{rows.sort((a,b)=>b.votes-a.votes).map(row=>{const option:any=options.get(row.id);return <div key={row.id}><BarRow label={option?.name??row.id} value={row.votes} total={total} color={option?.color??'#64748b'}/><p className="mt-1 text-right text-xs text-slate-500">{total?(row.votes/total*100).toFixed(2):'0.00'}%</p></div>;})}</div>
      {!rows.length&&<p className="mt-4 text-sm text-slate-500">Aún no hay resultados publicados.</p>}
    </Card>
    <Card><p className="text-sm text-slate-500">Mesas informadas</p><p className="text-2xl font-bold">{informed.toLocaleString('es-CO')} / {tables.length.toLocaleString('es-CO')}</p><div className="mt-2 h-3 rounded-full bg-slate-100"><div className="h-3 rounded-full bg-violet-600" style={{width:`${informedPct}%`}}/></div><p className="mt-1 text-sm text-slate-500">{informedPct.toFixed(1)}%</p></Card>
  </PageShell>;
}

