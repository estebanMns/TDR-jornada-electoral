import type { Notice } from '../state/resultsStore';

/** Visible explanation whenever a number goes DOWN (correction or acta under review). */
export function CorrectionNotice({ notice }: { notice: Notice }) {
  const text =
    notice.kind === 'CORRECTION'
      ? `Corrección del acta ${notice.acta}: los totales se actualizaron con la nueva versión.`
      : `El acta ${notice.acta} pasó a verificación: sus votos no cuentan hasta que un auditor la revise.`;
  return (
    <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
      {text}
      <span className="ml-1 text-ink-soft">({new Date(notice.at).toLocaleTimeString('es-CO')})</span>
    </p>
  );
}
