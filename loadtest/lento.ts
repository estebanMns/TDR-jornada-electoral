import net from 'node:net';
import { parseArgs } from 'node:util';
const {values}=parseArgs({options:{host:{type:'string',default:'127.0.0.1'},port:{type:'string',default:'3000'},path:{type:'string',default:'/api/publico/stream?topics=dep'}}});
const socket=net.connect(Number(values.port),values.host,()=>socket.write(`GET ${values.path} HTTP/1.1\r\nHost: ${values.host}\r\nAccept: text/event-stream\r\nConnection: keep-alive\r\n\r\n`));
socket.on('data',chunk=>{socket.pause();const delay=chunk.length/1024*1000;setTimeout(()=>socket.resume(),delay);});
socket.on('close',()=>console.log('El servidor cerró la conexión lenta.'));
socket.on('error',e=>console.error(e.message));
