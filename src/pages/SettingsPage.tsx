import { useEffect, useState } from 'react';
import { ArrowLeft, Settings } from 'lucide-react';
import { ZeloMenuCouponsCard } from '../components/zelomenu/ZeloMenuCouponsCard';
import { ZeloMenuOrderSettingsCard } from '../components/zelomenu/ZeloMenuOrderSettingsCard';
import { ZeloMenuPixCard } from '../components/zelomenu/ZeloMenuPixCard';
import { ZeloMenuBusinessHoursCard } from '../components/zelomenu/ZeloMenuBusinessHoursCard';
import { SettingsOverview } from '../components/zelomenu/SettingsOverview';
import { ZeloMenuSlugCard } from '../components/zelomenu/ZeloMenuSlugCard';
import { ZeloMenuDeliverySettingsPage } from './ZeloMenuDeliverySettingsPage';

export type SettingsPath = 'overview' | 'delivery' | 'hours' | 'admin';

type SettingsPageProps = {
  settingsPath?: SettingsPath;
  onOpenDelivery: () => void;
  onOpenHours: () => void;
  onOpenAdmin: () => void;
  onBackToOverview: () => void;
};

type DesktopTab = 'hours' | 'orders' | 'pix' | 'coupons' | 'delivery' | 'admin';

export function SettingsPage({
  settingsPath = 'overview',
  onOpenDelivery,
  onOpenHours,
  onOpenAdmin,
  onBackToOverview,
}: SettingsPageProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return settingsPath === 'delivery' ? (
      <ZeloMenuDeliverySettingsPage onBack={onBackToOverview} />
    ) : settingsPath === 'hours' ? (
      <div className="mx-auto w-full max-w-[1120px] space-y-5 px-4 pb-8 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-9">
        <button
          type="button"
          onClick={onBackToOverview}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para configurações
        </button>
        <ZeloMenuBusinessHoursCard />
      </div>
    ) : settingsPath === 'admin' ? (
      <AdminActionsSettings onBack={onBackToOverview} />
    ) : (
      <SettingsOverview onOpenDelivery={onOpenDelivery} onOpenHours={onOpenHours} onOpenAdmin={onOpenAdmin} />
    );
  }

  return <DesktopSettingsWorkspace settingsPath={settingsPath} onOpenDelivery={onOpenDelivery} onOpenHours={onOpenHours} onOpenAdmin={onOpenAdmin} onBackToOverview={onBackToOverview} />;
}

function DesktopSettingsWorkspace({
  settingsPath,
  onOpenDelivery,
  onOpenHours,
  onOpenAdmin,
  onBackToOverview,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<DesktopTab>(
    settingsPath === 'delivery'
      ? 'delivery'
      : settingsPath === 'hours'
        ? 'hours'
        : settingsPath === 'admin'
          ? 'admin'
          : 'orders',
  );

  useEffect(() => {
    if (settingsPath === 'delivery') setActiveTab('delivery');
    if (settingsPath === 'hours') setActiveTab('hours');
    if (settingsPath === 'admin') setActiveTab('admin');
    if (settingsPath === 'overview' && activeTab === 'admin') setActiveTab('orders');
  }, [activeTab, settingsPath]);

  function selectTab(tab: DesktopTab) {
    setActiveTab(tab);
    if (tab === 'hours') {
      onOpenHours();
    } else if (tab === 'delivery') {
      onOpenDelivery();
    } else if (tab === 'admin') {
      onOpenAdmin();
    } else if (settingsPath !== 'overview') {
      onBackToOverview();
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 px-6 pb-8 pt-8 lg:px-8">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <Settings className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-ink)]">Configurações</h1>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Configure pedidos, pagamento via Pix, cupons e entrega.
          </p>
        </div>
      </header>

      <nav className="border-b border-[var(--color-line)]" aria-label="Seções de configurações">
        <div className="flex gap-8 overflow-x-auto" role="tablist">
          <DesktopTabButton label="Horários" active={activeTab === 'hours'} onClick={() => selectTab('hours')} />
          <DesktopTabButton label="Pedidos online" active={activeTab === 'orders'} onClick={() => selectTab('orders')} />
          <DesktopTabButton label="Pagamento via Pix" active={activeTab === 'pix'} onClick={() => selectTab('pix')} />
          <DesktopTabButton label="Cupons de desconto" active={activeTab === 'coupons'} onClick={() => selectTab('coupons')} />
          <DesktopTabButton label="Entrega" active={activeTab === 'delivery'} onClick={() => selectTab('delivery')} />
          <DesktopTabButton label="Ações administrativas" active={activeTab === 'admin'} onClick={() => selectTab('admin')} />
        </div>
      </nav>

      {activeTab === 'hours' && <ZeloMenuBusinessHoursCard />}
      {activeTab === 'orders' && <ZeloMenuOrderSettingsCard />}
      {activeTab === 'pix' && <ZeloMenuPixCard />}
      {activeTab === 'coupons' && <ZeloMenuCouponsCard />}
      {activeTab === 'delivery' && <ZeloMenuDeliverySettingsPage onBack={onBackToOverview} />}
      {activeTab === 'admin' && <AdminActionsSettings onBack={onBackToOverview} />}
    </div>
  );
}

function AdminActionsSettings({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)] md:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para configurações
      </button>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-[-0.01em] text-[var(--color-ink)]">Ações administrativas</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Ajustes de acesso e manutenção do seu cardápio. Novas ações administrativas ficarão aqui.
          </p>
        </div>
      </div>
      <ZeloMenuSlugCard />
    </div>
  );
}

function DesktopTabButton({
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
      className={`min-h-12 whitespace-nowrap border-b-2 px-0.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 focus-visible:ring-offset-2 ${
        active
          ? 'border-[var(--color-brand)] text-[var(--color-brand-deep)]'
          : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {label}
    </button>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
