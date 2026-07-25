import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { ZeloMenuCouponsCard } from '../components/zelomenu/ZeloMenuCouponsCard';
import { ZeloMenuOrderSettingsCard } from '../components/zelomenu/ZeloMenuOrderSettingsCard';
import { ZeloMenuPixCard } from '../components/zelomenu/ZeloMenuPixCard';
import { SettingsOverview } from '../components/zelomenu/SettingsOverview';
import { ZeloMenuDeliverySettingsPage } from './ZeloMenuDeliverySettingsPage';

export type SettingsPath = 'overview' | 'delivery';

type SettingsPageProps = {
  settingsPath?: SettingsPath;
  onOpenDelivery: () => void;
  onBackToOverview: () => void;
};

type DesktopTab = 'orders' | 'pix' | 'coupons' | 'delivery';

export function SettingsPage({
  settingsPath = 'overview',
  onOpenDelivery,
  onBackToOverview,
}: SettingsPageProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return settingsPath === 'delivery' ? (
      <ZeloMenuDeliverySettingsPage onBack={onBackToOverview} />
    ) : (
      <SettingsOverview onOpenDelivery={onOpenDelivery} />
    );
  }

  return <DesktopSettingsWorkspace settingsPath={settingsPath} onOpenDelivery={onOpenDelivery} onBackToOverview={onBackToOverview} />;
}

function DesktopSettingsWorkspace({
  settingsPath,
  onOpenDelivery,
  onBackToOverview,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<DesktopTab>(settingsPath === 'delivery' ? 'delivery' : 'orders');

  useEffect(() => {
    if (settingsPath === 'delivery') setActiveTab('delivery');
  }, [settingsPath]);

  function selectTab(tab: DesktopTab) {
    setActiveTab(tab);
    if (tab === 'delivery') {
      onOpenDelivery();
    } else if (settingsPath === 'delivery') {
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
          <DesktopTabButton label="Pedidos online" active={activeTab === 'orders'} onClick={() => selectTab('orders')} />
          <DesktopTabButton label="Pagamento via Pix" active={activeTab === 'pix'} onClick={() => selectTab('pix')} />
          <DesktopTabButton label="Cupons de desconto" active={activeTab === 'coupons'} onClick={() => selectTab('coupons')} />
          <DesktopTabButton label="Entrega" active={activeTab === 'delivery'} onClick={() => selectTab('delivery')} />
        </div>
      </nav>

      {activeTab === 'orders' && <ZeloMenuOrderSettingsCard />}
      {activeTab === 'pix' && <ZeloMenuPixCard />}
      {activeTab === 'coupons' && <ZeloMenuCouponsCard />}
      {activeTab === 'delivery' && <ZeloMenuDeliverySettingsPage onBack={onBackToOverview} />}
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
