import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`} {...props}>{children}</section>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'success'|'warning'|'danger'|'neutral' }) {
  const c = { success:'bg-emerald-100 text-emerald-800', warning:'bg-amber-100 text-amber-900', danger:'bg-rose-100 text-rose-800', neutral:'bg-slate-100 text-slate-700' };
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${c[tone]}`}>{children}</span>;
}
export function StatusDot({ status }: { status:'live'|'reconnecting'|'paused' }) {
  const c = status==='live'?'bg-emerald-500':status==='paused'?'bg-amber-500':'bg-rose-500';
  const label = status==='live'?'En vivo':status==='paused'?'Pausado':'Reconectando';
  return <span className="inline-flex items-center gap-2 text-sm"><i className={`h-2.5 w-2.5 rounded-full ${c}`} />{label}</span>;
}
export function BarRow({ label, value, total, color }: { label:string; value:number; total:number; color:string }) {
  const width = total ? Math.max(0, Math.min(100, value/total*100)) : 0;
  return <div className="grid grid-cols-[minmax(7rem,auto)_1fr_auto] items-center gap-3"><span className="truncate text-sm">{label}</span><div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full" style={{width:`${width}%`,backgroundColor:color}} /></div><b className="text-sm tabular-nums">{value.toLocaleString('es-CO')}</b></div>;
}
export function Stat({ label, value }: { label:string; value:ReactNode }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>;
}
export function PageShell({ title, children }: { title:string; children:ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-6xl space-y-6 px-4 py-8"><header><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Preconteo electoral</p><h1 className="mt-1 text-3xl font-bold">{title}</h1></header>{children}</main>;
}
