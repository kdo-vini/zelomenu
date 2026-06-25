import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useZeloMenuEntitlement } from '../hooks/useZeloMenuEntitlement';
import { useCatalog } from '../hooks/useCatalog';
import { CatalogView } from '../components/views/CatalogView';
import { LoginForm } from '../components/LoginForm';
import { NeutralState } from '../components/NeutralState';
import { ZeloMenuSettingsCard } from '../components/zelomenu/ZeloMenuSettingsCard';
import { ZeloMenuSlugCard } from '../components/zelomenu/ZeloMenuSlugCard';
import { AdminLayout, type NavSection } from '../components/AdminLayout';
import { OnboardingWizard, ONBOARDING_KEY } from '../components/OnboardingWizard';
import { Settings } from 'lucide-react';

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
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-brand-soft)]">
          <Settings className="h-5 w-5 text-[var(--color-brand-deep)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">Publicação</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            Configure o link público e as informações da sua loja no cardápio digital.
          </p>
        </div>
      </header>
      <ZeloMenuSlugCard />
      <ZeloMenuSettingsCard />
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export function AdminPage() {
  const { session, loading: authLoading } = useAuth();
  const entitlement = useZeloMenuEntitlement(session);

  const [activeSection, setActiveSection] = useState<NavSection>(() => {
    const hash = window.location.hash.replace('#', '') as NavSection;
    return hash === 'publication' ? 'publication' : 'catalog';
  });

  const handleNavigate = (section: NavSection) => {
    setActiveSection(section);
    window.location.hash = section;
  };

  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem(ONBOARDING_KEY) === 'done',
  );

  const catalogEnabled = !!session && entitlement.hasAccess;
  const catalog = useCatalog(session, { enabled: catalogEnabled });

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

  return (
    <AdminLayout
      activeSection={activeSection}
      onNavigate={handleNavigate}
      catalogContent={catalogContent}
      publicationContent={<PublicationPage />}
    />
  );
}
