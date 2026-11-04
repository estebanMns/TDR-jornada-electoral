import http from 'node:http';
import { fork } from 'node:child_process';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';

const {values}=parseArgs({options:{url:{type:'string',default:'http://localhost:3000/api/publico/stream'},conexiones:{type:'string',default:'1000'},procesos:{type:'string',default:'4'}}});
const topics=()=>{const r=Math.random();return r<.6?'dep':r<.95?`mun:${1+Math.floor(Math.random()*30)}`:`station:${1+Math.floor(Math.random()*1842)}`;};
if(process.env.WORKER==='1'){
  const n=Number(process.env.COUNT), base=new URL(process.env.TARGET), stats={open:0,events:0,latencies:[] as number[]};
  for(let i=0;i<n;i++){
    const u=new URL(base);u.searchParams.set('topics',topics());
    const req=http.request(u,{headers:{accept:'text/event-stream'}});
    req.on('response',res=>{stats.open++;let buf='';res.on('data',chunk=>{buf+=chunk.toString();let at;while((at=buf.indexOf('\n\n'))>=0){const frame=buf.slice(0,at);buf=buf.slice(at+2);if(frame.includes('event: delta')){stats.events++;const match=frame.match(/"ts_rx":(\d+)/);if(match)stats.latencies.push(Math.max(0,Date.now()-Number(match[1])));}}});});
    req.on('error',()=>{});req.end();
  }
  setInterval(()=>{const sorted=[...stats.latencies].sort((a,b)=>a-b);process.send?.({open:stats.open,events:stats.events,p50:sorted[Math.floor(sorted.length*.5)]??null,p99:sorted[Math.floor(sorted.length*.99)]??null});},1000);
}else{
  const total=Number(values.conexiones),workers=Number(values.procesos),children=[];
  for(let i=0;i<workers;i++){const count=Math.floor(total/workers)+(i<total%workers?1:0);const child=fork(new URL(import.meta.url),[],{execArgv:['--import','tsx'],env:{...process.env,WORKER:'1',COUNT:String(count),TARGET:values.url}});child.on('message',m=>console.log(JSON.stringify({worker:i,...m})));children.push(child);}
  console.log(`Conexiones solicitadas: ${total}; procesos: ${workers}`);
}
