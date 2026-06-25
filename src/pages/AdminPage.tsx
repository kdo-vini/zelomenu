import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useZeloMenuEntitlement } from '../hooks/useZeloMenuEntitlement';
import { useCatalog } from '../hooks/useCatalog';
import { CatalogView } from '../components/views/CatalogView';
import { NeutralState } from '../components/NeutralState';
import { ZeloMenuSettingsCard } from '../components/zelomenu/ZeloMenuSettingsCard';
import { ZeloMenuSlugCard } from '../components/zelomenu/ZeloMenuSlugCard';
import { supabase } from '../services/supabaseClient';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';

/**
 * /admin — the ZeloMenu owner config surface.
 *
 * Uses @supabase/ssr cookie storage scoped to .zelopdv.com.br so the session
 * is shared across all subdomains. If no session exists yet, a login form
 * allows signing in directly from this origin.
 */

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

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

  const handleGoogle = async () => {
    setError(null);
    setGoogleSubmitting(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Supabase redirects back here with ?code=...; AuthCallbackPage
          // exchanges it and lands the user on /admin.
          redirectTo: `${window.location.origin}/auth/callback?next=/admin`,
        },
      });
      if (oauthError) throw oauthError;
      // On success the browser navigates away to Google — no further work here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar com Google.');
      setGoogleSubmitting(false);
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

        <button
          type="button"
          onClick={handleGoogle}
          disabled={googleSubmitting || submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
        >
          {googleSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          Entrar com Google
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--color-line)]" />
          <span className="text-xs text-[var(--color-ink-faint)]">ou</span>
          <div className="h-px flex-1 bg-[var(--color-line)]" />
        </div>

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
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="order-2 min-w-0 lg:order-1">
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
          </div>
          <aside className="order-1 flex flex-col gap-6 lg:order-2">
            <ZeloMenuSlugCard />
            <ZeloMenuSettingsCard />
          </aside>
        </div>
      </div>
    </div>
  );
}
