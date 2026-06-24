import { useAuth } from '../contexts/AuthContext';
import { useZeloMenuEntitlement } from '../hooks/useZeloMenuEntitlement';
import { useCatalog } from '../hooks/useCatalog';
import { CatalogView } from '../components/views/CatalogView';
import { NeutralState } from '../components/NeutralState';

/**
 * /admin — the ZeloMenu owner config surface.
 *
 * Entitlement gate (no login screen — auth comes from the PDV/Chat session):
 *  1. Read the Supabase session (AuthContext).
 *  2. No session  → neutral PT-BR state ("Acesse pelo seu painel...").
 *  3. Session     → fetch the user's `subscriptions` row, build the entitlement
 *                   signals, and call `hasZeloMenuAccess` (domain/zelomenuEntitlements).
 *  4. hasAccess === false → neutral blocked/upsell PT-BR state.
 *  5. hasAccess === true  → render CatalogView scoped to that owner
 *                           (`id_usuario = session.user.id`, exactly like the
 *                           existing ZeloChat config path; no sub-user→owner
 *                           resolution happens there, so we mirror it).
 *
 * TODO: cookie-SSO handshake + redirect from PDV/Chat. Until cross-subdomain
 * cookie storage is wired (services/supabaseClient.ts), a fresh visit with no
 * local session lands on the neutral state instead of inheriting the PDV/Chat
 * session.
 */
export function AdminPage() {
  const { session, loading: authLoading } = useAuth();
  const entitlement = useZeloMenuEntitlement(session);

  // `useCatalog` is scoped to session.user.id (the owner) and only loads once
  // the owner is entitled — same gating the ZeloChat AppShell applies.
  const catalogEnabled = !!session && entitlement.hasAccess;
  const catalog = useCatalog(session, { enabled: catalogEnabled });

  if (authLoading || (session && entitlement.loading)) {
    return (
      <NeutralState
        title="Carregando…"
        description="Verificando seu acesso ao ZeloMenu."
      />
    );
  }

  if (!session) {
    return (
      <NeutralState
        title="ZeloMenu"
        description="Acesse pelo seu painel ZeloPDV ou ZeloChat."
      />
    );
  }

  if (!entitlement.hasAccess) {
    return (
      <NeutralState
        title="ZeloMenu não está no seu plano"
        description={
          entitlement.isActiveWithoutMenu
            ? 'Sua assinatura atual não inclui o ZeloMenu. Faça o upgrade pelo seu painel ZeloPDV ou ZeloChat para publicar o cardápio.'
            : 'Assine um plano com ZeloMenu pelo seu painel ZeloPDV ou ZeloChat para publicar o cardápio.'
        }
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-canvas)]">
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
        deleteCategoria={catalog.deleteCategoria}
        createSubcategoria={catalog.createSubcategoria}
        updateSubcategoria={catalog.updateSubcategoria}
        deleteSubcategoria={catalog.deleteSubcategoria}
        createProduto={catalog.createProduto}
        updateProduto={catalog.updateProduto}
        deleteProduto={catalog.deleteProduto}
        upsertProductPublication={catalog.upsertProductPublication}
        replaceProductModifierGroups={catalog.replaceProductModifierGroups}
        uploadProductPublicationImage={catalog.uploadProductPublicationImage}
        deleteProductPublicationImage={catalog.deleteProductPublicationImage}
      />
    </div>
  );
}
