import { useEffect, useRef, useState } from 'react';
import { connectSse, type SseStatus } from '../../shared/net/sse';

export function usePublicResults(topic: string) {
  const values = useRef<Record<string, number>>({});
  const lastId = useRef('0-0');
  const queue = useRef<any[]>([]);
  const frame = useRef<number | null>(null);
  const [rows, setRows] = useState<{id:string; votes:number}[]>([]);
  const [status, setStatus] = useState<SseStatus>('reconnecting');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [correction, setCorrection] = useState<string | null>(null);
  const [informed, setInformed] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const stop = connectSse({ url:`/api/publico/stream?topics=${encodeURIComponent(topic)}`, signal:controller.signal, onStatus:setStatus,
      onMessage: message => {
        if (message.id && compareId(message.id, lastId.current) <= 0) return;
        queue.current.push(message);
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          for (const item of queue.current.splice(0)) {
            const data = item.data ?? {};
            if (item.event === 'snapshot') {
              values.current = { ...(data.abs ?? {}) };
              setInformed(Number(data.mesasInformadas ?? 0));
            } else if (item.event === 'delta') {
              for (const [id, nextValue] of Object.entries(data.abs ?? {})) {
                const next = Number(nextValue), previous = values.current[id] ?? 0;
                if (next < previous) setCorrection(data.motivos?.[0] ?? 'Corrección de acta registrada');
                values.current[id] = next;
              }
            }
            if (item.id) lastId.current = item.id;
            setUpdatedAt(Date.now());
          }
          setRows(Object.entries(values.current).map(([id,votes])=>({id,votes})));
        });
      }});
    return () => { stop(); controller.abort(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [topic]);
  return { rows, status, updatedAt, correction, informed };
}
function compareId(a:string,b:string) { const [at,as]=a.split('-').map(Number),[bt,bs]=b.split('-').map(Number); return at===bt?as-bs:at-bt; }
