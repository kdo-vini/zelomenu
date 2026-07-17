import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { planAuthCallback } from '../domain/authCallback';
import { NeutralState } from '../components/NeutralState';

/**
 * /auth/callback — completes a Supabase auth redirect and lands the user back
 * in the app with a live session.
 *
 * Handles two flows:
 *
 *  1. PKCE / magic-link / OAuth: Supabase redirects here with `?code=...`.
 *     The Supabase client is built with `@supabase/ssr` (`flowType: 'pkce'`,
 *     `detectSessionInUrl: true`), so supabase-js exchanges the code on its own
 *     during init and consumes the single-use `code_verifier`. We must NOT call
 *     `exchangeCodeForSession` here — a second exchange fails with
 *     "PKCE code verifier not found in storage". We just wait for the session.
 *
 *  2. SSO handoff (e.g. from ZeloPDV/ZeloChat): the caller redirects here with
 *     `#access_token=...&refresh_token=...` in the URL hash. We call
 *     `setSession` directly so the shared `.zelopdv.com.br` cookie is written
 *     here too.
 *
 * On success we go to `?next=` (default `/admin`). On failure we surface the
 * error and offer a link back to /admin (which shows the login form).
 */

/** How long to wait for the automatic PKCE exchange before giving up. */
const SESSION_WAIT_MS = 10_000;

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;
    const url = new URL(window.location.href);
    const next = url.searchParams.get('next') || '/admin';

    const goNext = () => {
      if (settled) return;
      settled = true;
      navigate(next, { replace: true });
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      setError(message);
    };

    const plan = planAuthCallback(window.location.search, window.location.hash);

    // Subscribe before anything else so we never miss the SIGNED_IN /
    // INITIAL_SESSION that the automatic PKCE exchange fires.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) goNext();
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function complete() {
      try {
        switch (plan.kind) {
          case 'error':
            throw new Error(plan.message);

          case 'await-detected-session': {
            // supabase-js exchanges `?code=` automatically. It may already be
            // done (check now) or land shortly (onAuthStateChange handles it).
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              goNext();
              return;
            }
            timeout = setTimeout(() => {
              void supabase.auth.getSession().then(({ data: late }) => {
                if (late.session) goNext();
                else fail('Não foi possível concluir o login no tempo esperado.');
              });
            }, SESSION_WAIT_MS);
            return;
          }

          case 'set-session': {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token: plan.accessToken,
              refresh_token: plan.refreshToken,
            });
            if (setSessionError) throw setSessionError;
            goNext();
            return;
          }

          case 'require-existing-session': {
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
              throw new Error('Nenhum código de autenticação encontrado no link.');
            }
            goNext();
            return;
          }
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Falha ao concluir o login.');
      }
    }

    void complete();

    return () => {
      settled = true;
      subscription.unsubscribe();
      if (timeout) clearTimeout(timeout);
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
