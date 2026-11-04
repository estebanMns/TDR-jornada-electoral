import type { ReactNode } from 'react';

/** Page frame shared by the public and operations screens. */
export function PageShell({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand">Preconteo electoral</p>
            <h1 className="text-xl font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}
          </div>
          {actions}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">{children}</main>
    </div>
  );
}
