import Redis from 'ioredis';
const redis=new Redis(process.env.REDIS_URL??'redis://127.0.0.1:6379');
const topics=['dep',...Array.from({length:30},(_,i)=>`mun:${i+1}`),...Array.from({length:1842},(_,i)=>`station:${i+1}`)];
const totals=new Map<string,number>();
async function publish(topic:string){
  const current=(totals.get(topic)??0)+1;totals.set(topic,current);
  const abs={C1:current,C2:Math.floor(current*.82),C3:Math.floor(current*.64),C4:Math.floor(current*.41),C5:Math.floor(current*.22),BLANK:Math.floor(current*.03),NULL:0,UNMARKED:0};
  await redis.xadd('ev:all','*','topic',topic,'abs',JSON.stringify(abs),'motivos',JSON.stringify([]),'ts_rx',String(Date.now()));
}
const timer=setInterval(()=>void publish(topics[Math.floor(Math.random()*topics.length)]),200);
process.on('SIGUSR2',async()=>{for(let i=0;i<300;i++)await publish(topics[i%topics.length]);});
process.on('SIGINT',async()=>{clearInterval(timer);await redis.quit();process.exit(0);});
console.log('Publicando ~5 eventos/s en ev:all; SIGUSR2 genera ráfaga de 300.');
