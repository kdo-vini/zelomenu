import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { NeutralState } from '../components/NeutralState';

/**
 * /auth/callback — completes a Supabase auth redirect and lands the user back
 * in the app with a live session.
 *
 * Handles two flows:
 *
 *  1. PKCE / magic-link / OAuth: Supabase redirects here with `?code=...`.
 *     We exchange the code for a session (`exchangeCodeForSession`).
 *
 *  2. SSO handoff (e.g. from ZeloPDV/ZeloChat): the caller redirects here with
 *     `#access_token=...&refresh_token=...` in the URL hash. We call
 *     `setSession` directly so the shared `.zelopdv.com.br` cookie is written
 *     here too.
 *
 * On success we go to `?next=` (default `/admin`). On failure we surface the
 * error and offer a link back to /admin (which shows the login form).
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function complete() {
      const url = new URL(window.location.href);
      const next = url.searchParams.get('next') || '/admin';

      try {
        const code = url.searchParams.get('code');
        const hash = new URLSearchParams(
          window.location.hash.startsWith('#')
            ? window.location.hash.slice(1)
            : window.location.hash,
        );
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        const hashError = hash.get('error_description') || url.searchParams.get('error_description');

        if (hashError) {
          throw new Error(hashError);
        }

        if (code) {
          // PKCE / magic-link / OAuth flow.
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken) {
          // SSO handoff with tokens in the hash.
          const { error: setError2 } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setError2) throw setError2;
        } else {
          // Nothing to process — maybe the session already exists. Verify, else
          // bounce to the login form.
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            throw new Error('Nenhum código de autenticação encontrado no link.');
          }
        }

        if (!cancelled) {
          // Clean the auth params out of the URL and land in the app.
          navigate(next, { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Falha ao concluir o login.');
        }
      }
    }

    void complete();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <NeutralState
        title="Não foi possível concluir o login"
        description={`${error} Volte e tente entrar novamente pelo /admin.`}
      />
    );
  }

  return (
    <NeutralState
      title="Concluindo login…"
      description="Validando sua sessão do ZeloMenu."
    />
  );
}
