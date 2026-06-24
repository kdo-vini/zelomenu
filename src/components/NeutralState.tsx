import type { ReactNode } from 'react';

type NeutralStateProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

/**
 * Neutral, login-free placeholder. Used when there is no session (auth comes
 * from PDV/Chat) or when the owner is not entitled to the ZeloMenu. No login
 * form here — that is an explicit product decision.
 */
export function NeutralState({ title, description, children }: NeutralStateProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <span className="text-xl font-bold">Z</span>
        </div>
        <h1 className="text-lg font-bold text-[var(--color-ink)]">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">{description}</p>
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </div>
  );
}
