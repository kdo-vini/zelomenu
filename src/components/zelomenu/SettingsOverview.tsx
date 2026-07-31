import { useEffect, useState } from 'react';
import { Check, ClipboardCheck, QrCode, Save, SlidersHorizontal, Tag, Loader2 } from 'lucide-react';
import { getZeloMenuSettings, updateZeloMenuSettings } from '../../services/zelomenuAdminApi';
import { ZeloMenuDeliverySummaryCard } from './ZeloMenuDeliverySummaryCard';

type OverviewAnchor = 'orders' | 'pix' | 'coupons' | 'delivery';

export function SettingsOverview({
  onOpenDelivery,
  onOpenHours,
  onOpenAdmin,
}: {
  onOpenDelivery: () => void;
  onOpenHours: () => void;
  onOpenAdmin: () => void;
}) {
  const [activeAnchor, setActiveAnchor] = useState<OverviewAnchor>('delivery');

  function focusCard(anchor: OverviewAnchor) {
    setActiveAnchor(anchor);
    document.getElementById(`settings-${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-5 px-4 pb-8 pt-5 sm:space-y-6 sm:px-6 sm:pt-7 lg:px-8 lg:pt-9">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <SlidersHorizontal className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-[var(--color-ink)] sm:text-2xl">Configurações</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[var(--color-ink-muted)] sm:text-sm">
            Configure o recebimento de pedidos, pagamento via Pix e cupons de desconto.
          </p>
        </div>
      </header>

      <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Seções de configurações">
        <div className="flex min-w-max gap-6 border-b border-[var(--color-line)] sm:gap-8">
          <OverviewTab label="Horários" active={false} onClick={onOpenHours} />
          <OverviewTab label="Pedidos online" active={activeAnchor === 'orders'} onClick={() => focusCard('orders')} />
          <OverviewTab label="Pagamento via Pix" active={activeAnchor === 'pix'} onClick={() => focusCard('pix')} />
          <OverviewTab label="Cupons" active={activeAnchor === 'coupons'} onClick={() => focusCard('coupons')} />
          <OverviewTab label="Entrega" active={activeAnchor === 'delivery'} onClick={() => focusCard('delivery')} />
          <OverviewTab label="Ações administrativas" active={false} onClick={onOpenAdmin} />
        </div>
      </nav>

      <div className="space-y-5 sm:space-y-6">
        <div id="settings-delivery" className="scroll-mt-5">
          <ZeloMenuDeliverySummaryCard onConfigure={onOpenDelivery} />
        </div>

        <div id="settings-orders" className="scroll-mt-5">
          <OrderSummaryCard onEdit={() => focusCard('orders')} />
        </div>

        <div id="settings-pix" className="scroll-mt-5">
          <SummaryCard
            icon={QrCode}
            title="Pagamento via Pix"
            description="Gere o código Pix Copia e Cola com o valor do pedido, na tela de confirmação do cliente."
            action="Editar configuração"
            onAction={() => focusCard('pix')}
          />
        </div>

        <div id="settings-coupons" className="scroll-mt-5">
          <SummaryCard
            icon={Tag}
            title="Cupons de desconto"
            description="Crie códigos promocionais e acompanhe as condições de uso da sua loja."
            action="Editar configuração"
            onAction={() => focusCard('coupons')}
          />
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-12 whitespace-nowrap border-b-2 px-0.5 text-[12px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 focus-visible:ring-offset-2 sm:text-[13px] ${
        active
          ? 'border-[var(--color-brand)] text-[var(--color-brand-deep)]'
          : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {label}
    </button>
  );
}

function OrderSummaryCard({ onEdit }: { onEdit: () => void }) {
  const [autoAccept, setAutoAccept] = useState(false);
  const [pixVerification, setPixVerification] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getZeloMenuSettings()
      .then((settings) => {
        if (!active) return;
        setAutoAccept(settings.autoAcceptOrders);
        setPixVerification(settings.pixReceiptVerificationEnabled);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar o status dos pedidos.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  async function toggleAutoAccept() {
    const nextValue = !autoAccept;
    setAutoAccept(nextValue);
    setSaving(true);
    setError(null);
    try {
      await updateZeloMenuSettings({ autoAcceptOrders: nextValue });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch {
      setAutoAccept(!nextValue);
      setError('Não foi possível salvar o status dos pedidos.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]">
      <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-5 py-4 sm:px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <ClipboardCheck className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">Pedidos online</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">Defina como novos pedidos entram na operação.</p>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 rounded-2xl bg-[var(--color-canvas)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Aceitar pedidos automaticamente?</p>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              Quando estiver em “Sim”, pedidos públicos já validados entram direto como aceitos e seguem para a produção. Com “Não”, aguardam sua revisão.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autoAccept}
            aria-label="Aceitar pedidos automaticamente"
            onClick={() => void toggleAutoAccept()}
            disabled={loading || saving}
            className={`flex min-h-12 shrink-0 items-center gap-2 self-start rounded-full border px-1.5 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 sm:self-center ${
              autoAccept
                ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                : 'border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-soft)]'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span className={`flex h-9 min-w-14 items-center justify-center rounded-full px-3 text-sm font-bold ${autoAccept ? 'bg-white/15' : 'bg-[var(--color-canvas)]'}`}>
              {loading ? '…' : autoAccept ? 'Sim' : 'Não'}
            </span>
            <span className={`mr-1 h-3 w-3 rounded-full ${autoAccept ? 'bg-white' : 'bg-[var(--color-line-strong)]'}`} aria-hidden="true" />
          </button>
        </div>

        <div className="rounded-xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/35 px-4 py-3 text-[13px] leading-relaxed text-[var(--color-brand-deep)]">
          {autoAccept && pixVerification
            ? 'A conferência de comprovante Pix está ativa: pedidos Pix aguardam validação antes de serem aceitos automaticamente.'
            : autoAccept
              ? 'Pedidos públicos validados entram direto como aceitos, inclusive os pagos via Pix.'
              : 'O comportamento atual está mantido: você revisa e aceita cada pedido na operação.'}
        </div>

        {error && <p role="alert" className="text-xs text-[var(--color-alert)]">{error}</p>}

        <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex min-h-6 items-center gap-1.5 text-xs font-semibold text-[var(--color-success)]" aria-live="polite">
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando…</> : saved ? <><Check className="h-3.5 w-3.5" /> Salvo</> : null}
          </span>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
          >
            <Save className="h-4 w-4" strokeWidth={1.8} />
            Editar configuração
          </button>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  title,
  description,
  action,
  onAction,
}: {
  icon: typeof QrCode;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_12px_30px_rgba(36,31,54,0.05)]">
      <div className="flex items-center gap-3 px-5 py-5 sm:px-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-[var(--color-ink)]">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">{description}</p>
        </div>
      </div>
      <div className="border-t border-[var(--color-line)] px-5 py-4 sm:px-6">
        <button
          type="button"
          onClick={onAction}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
        >
          {action}
        </button>
      </div>
    </section>
  );
}
