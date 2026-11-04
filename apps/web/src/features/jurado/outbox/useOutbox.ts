import { useEffect, useSyncExternalStore } from 'react';
import { getSession } from '../../../app/session';
import { Outbox } from './outbox';

/** One dispatcher per tab (several tabs coordinate through a Web Lock). */
export const outbox = new Outbox({ getToken: () => getSession()?.token ?? null });

let started = false;

export function useOutbox() {
  useEffect(() => {
    if (started) return;
    started = true;
    void outbox.start();
  }, []);
  const entries = useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);
  return { outbox, entries };
}
