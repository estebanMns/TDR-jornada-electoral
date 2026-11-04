import type { JurorActaState } from '@electoral/shared';
import type { OutboxEntry } from './outbox/outboxStore';

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface StatusView {
  label: string;
  tone: Tone;
  detail?: string;
}

const RECEIPT_VIEWS: Record<string, StatusView> = {
  REGISTERED: { label: 'Registrada ✓', tone: 'success' },
  ALREADY_REGISTERED: { label: 'Ya estaba registrada ✓', tone: 'success', detail: 'El servidor ya la tenía; no se sumó dos veces.' },
  OBSOLETE: { label: 'Versión obsoleta', tone: 'neutral', detail: 'Ya existe una versión más reciente de esta acta.' },
  UNDER_REVIEW: { label: 'En verificación', tone: 'warning', detail: 'No suma hasta que un auditor la revise.' },
  CONFLICT: { label: 'En verificación (conflicto)', tone: 'warning', detail: 'Llegó otra copia de esta versión con datos distintos.' },
};

const ERROR_DETAILS: Record<string, string> = {
  NOT_REGISTERED: 'No registrada. Está guardada en tu teléfono y se enviará sola.',
  OFFLINE: 'Sin conexión. Está guardada en tu teléfono y se enviará sola.',
  TIMEOUT: 'El servidor no respondió a tiempo. Se reintentará sola.',
  SESSION_EXPIRED: 'Tu sesión expiró. Vuelve a iniciar sesión; el acta sigue guardada.',
  RATE_LIMIT: 'Demasiados intentos seguidos. Se reintentará en un momento.',
};

/** What the juror sees for one transmission, combining the local outbox and the server state. */
export function describeEntry(entry: OutboxEntry, online: boolean, server?: JurorActaState): StatusView {
  switch (entry.state) {
    case 'SENDING':
      return { label: 'Enviando…', tone: 'progress' };
    case 'QUEUED':
      if (!online) return { label: 'En cola (sin red)', tone: 'neutral', detail: ERROR_DETAILS.OFFLINE };
      return {
        label: entry.lastError ? 'Reintentando' : 'En cola',
        tone: 'progress',
        detail: entry.lastError ? (ERROR_DETAILS[entry.lastError] ?? ERROR_DETAILS.NOT_REGISTERED) : undefined,
      };
    case 'FAILED':
      return { label: 'Rechazada — corrige y retransmite', tone: 'danger', detail: `Motivo: ${entry.lastError ?? 'desconocido'}` };
    case 'DELIVERED': {
      const isCurrentVersion = server?.maxVersion === entry.submission.version;
      if (isCurrentVersion && server.status === 'REJECTED') {
        return { label: 'Rechazada — retransmitir', tone: 'danger', detail: 'Un auditor la rechazó. Corrige el acta y envíala de nuevo.' };
      }
      if (isCurrentVersion && server.status === 'APPLIED' && server.reason) {
        return { label: 'Aprobada ✓', tone: 'success', detail: 'Un auditor la revisó y la aprobó.' };
      }
      return RECEIPT_VIEWS[entry.receipt?.result ?? ''] ?? { label: 'Entregada', tone: 'success' };
    }
  }
}

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300',
  progress: 'bg-blue-50 text-blue-800 ring-blue-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
};

/** Highest version known for the acta, locally or on the server. */
export function highestKnownVersion(actaId: string, entries: OutboxEntry[], server?: JurorActaState[] | null): number {
  const local = entries.filter((entry) => entry.submission.actaId === actaId).map((entry) => entry.submission.version);
  const remote = server?.find((state) => state.actaId === actaId)?.maxVersion ?? 0;
  return Math.max(0, remote, ...local);
}
