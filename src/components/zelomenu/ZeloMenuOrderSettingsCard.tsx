import { useEffect, useState } from 'react';
import { Check, ClipboardCheck, Loader2, Save } from 'lucide-react';
import { getZeloMenuSettings, updateZeloMenuSettings } from '../../services/zelomenuAdminApi';

export function ZeloMenuOrderSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(false);

  useEffect(() => {
    let active = true;
    void getZeloMenuSettings()
      .then((settings) => {
        if (active) setAutoAcceptOrders(settings.autoAcceptOrders);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar as configurações de pedidos.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  async function save() {
    try {
      setSaving(true);
      setError(null);
      await updateZeloMenuSettings({ autoAcceptOrders });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch {
      setError('Não foi possível salvar essa configuração. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-brand)]" aria-label="Carregando" />
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <ClipboardCheck className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Pedidos online</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">Defina como novos pedidos entram na operação.</p>
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Aceitar pedidos automaticamente?</p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--color-ink-muted)]">
              Quando estiver em “Sim”, pedidos públicos já validados entram direto como aceitos e seguem para a produção.
              Com “Não”, cada pedido fica aguardando sua revisão.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autoAcceptOrders}
            aria-label="Aceitar pedidos automaticamente"
            onClick={() => setAutoAcceptOrders((current) => !current)}
            disabled={saving}
            className={`flex min-h-12 shrink-0 items-center gap-2 self-start rounded-full border px-1.5 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 sm:self-center ${
              autoAcceptOrders
                ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                : 'border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-soft)]'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className={`flex h-9 min-w-14 items-center justify-center rounded-full px-3 text-sm font-bold transition-colors ${autoAcceptOrders ? 'bg-white/15' : 'bg-[var(--color-canvas)]'}`}>
              {autoAcceptOrders ? 'Sim' : 'Não'}
            </span>
            <span className={`mr-1 h-3 w-3 rounded-full ${autoAcceptOrders ? 'bg-white' : 'bg-[var(--color-line-strong)]'}`} aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/35 px-4 py-3 text-sm leading-relaxed text-[var(--color-brand-deep)]">
          {autoAcceptOrders
            ? 'O pedido ainda pode ficar aguardando pagamento Pix. Ele só será aceito depois que o pagamento for validado.'
            : 'O comportamento atual está mantido: você revisa e aceita cada pedido na operação.'}
        </div>

        {error && <p role="alert" className="text-sm text-[var(--color-alert)]">{error}</p>}

        <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex min-h-6 items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-deep)]" aria-live="polite">
            {saved && <><Check className="h-4 w-4" /> Salvo</>}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-deep)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando…' : 'Salvar configuração'}
          </button>
        </div>
      </div>
    </section>
  );
}
