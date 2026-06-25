import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useZeloMenuEntitlement } from '../hooks/useZeloMenuEntitlement';
import { useCatalog } from '../hooks/useCatalog';
import { CatalogView } from '../components/views/CatalogView';
import { NeutralState } from '../components/NeutralState';
import { supabase } from '../services/supabaseClient';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';

/**
 * /admin — the ZeloMenu owner config surface.
 *
 * Uses @supabase/ssr cookie storage scoped to .zelopdv.com.br so the session
 * is shared across all subdomains. If no session exists yet, a login form
 * allows signing in directly from this origin.
 */

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message === 'Invalid login credentials'
            ? 'Email ou senha inválidos.'
            : err.message
          : 'Erro ao fazer login. Tente novamente.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-soft)]">
            <LogIn className="h-6 w-6 text-[var(--color-brand-deep)]" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">ZeloMenu</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Faça login com sua conta ZeloPDV
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--color-alert-soft)] bg-[var(--color-alert-soft)] p-3 text-sm text-[var(--color-alert)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-[var(--color-ink)]">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-canvas)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]"
              placeholder="seu@email.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-[var(--color-ink)]">
              Senha
            </label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-canvas)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)] focus:ring-1 focus:ring-[var(--color-brand)]"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Entrando…
              </>
            ) : (
              'Entrar'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

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
    return <LoginForm />;
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
