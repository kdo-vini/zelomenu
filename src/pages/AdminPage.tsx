import { lazy, Suspense, useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { useZeloMenuEntitlement } from '../hooks/useZeloMenuEntitlement';
import { useCatalog } from '../hooks/useCatalog';
import { LoginForm } from '../components/LoginForm';
import { NeutralState } from '../components/NeutralState';
import { ZeloMenuSettingsCard } from '../components/zelomenu/ZeloMenuSettingsCard';
import { ZeloMenuReadinessCard } from '../components/zelomenu/ZeloMenuReadinessCard';
import { AdminLayout, type NavSection } from '../components/AdminLayout';
import { OnboardingWizard, ONBOARDING_KEY } from '../components/OnboardingWizard';
import { getZeloMenuSlug } from '../services/zelomenuAdminApi';
import { Globe2 } from 'lucide-react';
import type { SettingsPath } from './SettingsPage';
import type { ZeloMenuSettingsTab } from '../components/zelomenu/ZeloMenuSettingsCard';

const CatalogView = lazy(() => import('../components/views/CatalogView').then((module) => ({ default: module.CatalogView })));
const SettingsPage = lazy(() => import('./SettingsPage').then((module) => ({ default: module.SettingsPage })));
const ZeloMenuMetricsPage = lazy(() => import('./ZeloMenuMetricsPage').then((module) => ({ default: module.ZeloMenuMetricsPage })));
const MesasAdminSection = lazy(() => import('../components/zelomenu/MesasAdminSection').then((module) => ({ default: module.MesasAdminSection })));
const SupportPage = lazy(() => import('./SupportPage').then((module) => ({ default: module.SupportPage })));

// ─── Upsell ────────────────────────────────────────────────────────────────

function UpsellScreen({ isActiveWithoutMenu }: { isActiveWithoutMenu: boolean }) {
  return (
    <NeutralState
      title="ZeloMenu nao esta no seu plano"
      description={
        isActiveWithoutMenu
          ? 'Sua assinatura atual nao inclui o ZeloMenu. Faca o upgrade pelo seu painel ZeloPDV ou ZeloChat para publicar o cardapio.'
          : 'Assine um plano com ZeloMenu pelo seu painel ZeloPDV ou ZeloChat para publicar o cardapio.'
      }
    />
  );
}

// ─── Publication page ──────────────────────────────────────────────────────

function PublicationPage() {
  const [activeTab, setActiveTab] = useState<ZeloMenuSettingsTab>('visual');

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-8 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-9">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <Globe2 className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-ink)]">Publicação</h1>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Organize a aparência e o conteúdo que seus clientes encontram no cardápio.
          </p>
        </div>
      </header>

      <nav className="border-b border-[var(--color-line)]" aria-label="Seções de publicação">
        <div className="flex gap-8 overflow-x-auto" role="tablist">
          <PublicationTabButton
            label="Visual externo"
            active={activeTab === 'visual'}
            onClick={() => setActiveTab('visual')}
          />
          <PublicationTabButton
            label="Destaques e categorias"
            active={activeTab === 'highlights'}
            onClick={() => setActiveTab('highlights')}
          />
        </div>
      </nav>

      <ZeloMenuReadinessCard />

      <ZeloMenuSettingsCard activeTab={activeTab} />
    </div>
  );
}

function PublicationTabButton({
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

// ─── Root ──────────────────────────────────────────────────────────────────

function AdminPageContent() {
  const { session, loading: authLoading } = useAuth();
  const entitlement = useZeloMenuEntitlement(session);

  const [activeSection, setActiveSection] = useState<NavSection>(() => {
    return parseAdminHash(window.location.hash).section;
  });
  const [settingsPath, setSettingsPath] = useState<SettingsPath>(() => (
    parseAdminHash(window.location.hash).settingsPath
  ));

  useEffect(() => {
    const handleHashChange = () => {
      const parsed = parseAdminHash(window.location.hash);
      setActiveSection(parsed.section);
      setSettingsPath(parsed.settingsPath);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleNavigate = (section: NavSection) => {
    const nextHash = section === 'metrics' ? 'indicadores' : section;
    setActiveSection(section);
    setSettingsPath('overview');
    if (window.location.hash !== `#${nextHash}`) {
      window.location.hash = nextHash;
    }
  };

  const openDeliverySettings = () => {
    window.location.hash = 'settings/entrega/configurar';
  };

  const openHoursSettings = () => {
    window.location.hash = 'settings/horarios';
  };

  const openAdminSettings = () => {
    window.location.hash = 'settings/acoes-administrativas';
  };

  const returnToSettingsOverview = () => {
    window.location.hash = 'settings';
  };

  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem(ONBOARDING_KEY) === 'done',
  );

  const catalogEnabled = !!session && entitlement.hasAccess;
  const catalog = useCatalog(session, { enabled: catalogEnabled });

  const [slug, setSlug] = useState<string | null>(null);
  const [slugLoading, setSlugLoading] = useState(false);
  useEffect(() => {
    if (!session || !entitlement.hasAccess) return;
    setSlugLoading(true);
    getZeloMenuSlug()
      .then(({ slug: s }) => {
        setSlug(s);
        // If server has a slug, consider onboarding done even if localStorage is clean
        if (s) {
          localStorage.setItem(ONBOARDING_KEY, 'done');
          setOnboardingDone(true);
        }
      })
      .catch(() => undefined)
      .finally(() => setSlugLoading(false));
  }, [session, entitlement.hasAccess]);

  // Loading
  if (authLoading || (session && entitlement.loading)) {
    return <NeutralState title="Carregando..." description="Verificando seu acesso ao ZeloMenu." />;
  }

  // Not authenticated
  if (!session) return <LoginForm />;

  // No entitlement
  if (!entitlement.hasAccess) return <UpsellScreen isActiveWithoutMenu={entitlement.isActiveWithoutMenu} />;

  // First-time onboarding
  if (!onboardingDone) {
    return <OnboardingWizard onComplete={() => setOnboardingDone(true)} />;
  }

  const catalogContent = (
    <CatalogView
      isAuthenticated={!!session}
      authLoading={authLoading}
      canPublishToMenu={entitlement.capabilities.menu_publication}
      loading={catalog.loading}
      error={catalog.error}
      categorias={catalog.categorias}
      subcategorias={catalog.subcategorias}
      produtos={catalog.produtos}
      productPublications={catalog.productPublications}
      productModifierGroups={catalog.productModifierGroups}
      modifierOptionProducts={catalog.modifierOptionProducts}
      refresh={catalog.refresh}
      createCategoria={catalog.createCategoria}
      updateCategoria={catalog.updateCategoria}
      reorderCategorias={catalog.reorderCategorias}
      deleteCategoria={catalog.deleteCategoria}
      createSubcategoria={catalog.createSubcategoria}
      updateSubcategoria={catalog.updateSubcategoria}
      deleteSubcategoria={catalog.deleteSubcategoria}
      createProduto={catalog.createProduto}
      updateProduto={catalog.updateProduto}
      deleteProduto={catalog.deleteProduto}
      upsertProductPublication={catalog.upsertProductPublication}
      reorderProductPublications={catalog.reorderProductPublications}
      replaceProductModifierGroups={catalog.replaceProductModifierGroups}
      uploadProductPublicationImage={catalog.uploadProductPublicationImage}
      deleteProductPublicationImage={catalog.deleteProductPublicationImage}
    />
  );

  const showMesas =
    entitlement.capabilities.mesas && entitlement.capabilities.menu_publication;

  const mesasContent = showMesas
    ? slug
      ? <MesasAdminSection slug={slug} />
      : <NeutralState
        title={slugLoading ? 'Carregando mesas…' : 'Mesas indisponíveis'}
        description={slugLoading ? 'Preparando os QR Codes das suas mesas.' : 'Configure o link público do ZeloMenu para acessar esta seção.'}
      />
    : undefined;

  return (
    <Suspense fallback={<NeutralState title="Carregando painel..." description="Preparando esta área do ZeloMenu." />}>
      <AdminLayout
        activeSection={activeSection}
        onNavigate={handleNavigate}
        catalogContent={catalogContent}
        publicationContent={<PublicationPage />}
        settingsContent={
          <SettingsPage
            settingsPath={settingsPath}
            onOpenDelivery={openDeliverySettings}
            onOpenHours={openHoursSettings}
            onOpenAdmin={openAdminSettings}
            onBackToOverview={returnToSettingsOverview}
          />
        }
        metricsContent={<ZeloMenuMetricsPage />}
        mesasContent={mesasContent}
        supportContent={<SupportPage />}
      />
    </Suspense>
  );
}

export function AdminPage() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AdminPageContent />
      </ToastProvider>
    </AuthProvider>
  );
}

function parseAdminHash(rawHash: string): { section: NavSection; settingsPath: SettingsPath } {
  const hash = rawHash.replace(/^#/, '');
  if (hash === 'mesas') return { section: 'mesas', settingsPath: 'overview' };
  if (hash === 'publication') return { section: 'publication', settingsPath: 'overview' };
  if (hash === 'settings/entrega/configurar') return { section: 'settings', settingsPath: 'delivery' };
  if (hash === 'settings/horarios') return { section: 'settings', settingsPath: 'hours' };
  if (hash === 'settings/acoes-administrativas' || hash === 'settings/admin') return { section: 'settings', settingsPath: 'admin' };
  if (hash === 'indicadores' || hash === 'metrics' || hash === 'settings/indicadores') return { section: 'metrics', settingsPath: 'overview' };
  if (hash === 'support' || hash === 'ajuda') return { section: 'support', settingsPath: 'overview' };
  if (hash.startsWith('settings')) return { section: 'settings', settingsPath: 'overview' };
  return { section: 'catalog', settingsPath: 'overview' };
}
