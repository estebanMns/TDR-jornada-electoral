import { randomUUID, createHmac } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const {values}=parseArgs({options:{acelerar:{type:'string',default:'1'},url:{type:'string',default:'http://localhost:3000/api/actas'},mesas:{type:'string',default:'6400'}}});
const scale=Math.max(1,Number(values.acelerar)), total=Number(values.mesas), secret=process.env.JWT_SECRET;
if(!secret) throw new Error('Define JWT_SECRET para firmar los tokens de prueba.');
const start=Date.now(), duration=4*60*60*1000/scale, firstWindow=40*60*1000/scale;
const schedule=Array.from({length:total},(_,i)=>({i,at:i<Math.round(total*.55)?Math.random()*firstWindow:firstWindow+Math.random()*(duration-firstWindow)})).sort((a,b)=>a.at-b.at);
const idemByMesa=new Map<number,string>();let sent=0;
for(const item of schedule){
  const mesa=item.i+1, duplicate=Math.random()<.075, idem=duplicate?(idemByMesa.get(mesa)??randomUUID()):randomUUID();idemByMesa.set(mesa,idem);
  const correction=item.i<180, doubtful=Math.random()<.075;
  const now=Date.now(), payload={mesa,idem,version:correction?2:1,dudosa:doubtful,correccion:correction,votos:{C1:100+item.i,C2:80+item.i,C3:50,C4:40,C5:30,BLANK:2,NULL:1,UNMARKED:0}};
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), body=Buffer.from(JSON.stringify({sub:`jurado-${mesa}`,rol:'JUROR',mesa,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+3600})).toString('base64url');
  const unsigned=`${header}.${body}`, token=`${unsigned}.${createHmac('sha256',secret).update(unsigned).digest('base64url')}`;
  const wait=Math.max(0,start+item.at-Date.now());if(wait)await sleep(wait);
  await fetch(values.url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':idem},body:JSON.stringify(payload)}).catch(()=>{});
  sent++;if(sent%100===0)console.log(JSON.stringify({sent,total,elapsed:Date.now()-start}));
}
console.log(`Simulación terminada: ${sent} envíos.`);
