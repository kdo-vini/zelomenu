import { SlidersHorizontal } from 'lucide-react';
import { ZeloMenuOrderSettingsCard } from '../components/zelomenu/ZeloMenuOrderSettingsCard';

export function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)]">
          <SlidersHorizontal className="h-5 w-5 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">Configurações</h1>
          <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Ajuste o comportamento dos pedidos do seu ZeloMenu.
          </p>
        </div>
      </header>

      <ZeloMenuOrderSettingsCard />
    </div>
  );
}
