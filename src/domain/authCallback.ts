// Pure decision logic for the /auth/callback page. Kept free of React and the
// Supabase SDK so the branching is unit-testable.
//
// Context: the app's Supabase client is built with `@supabase/ssr`
// `createBrowserClient`, which forces `flowType: 'pkce'` and defaults
// `detectSessionInUrl: true`. That means supabase-js itself detects a `?code=`
// in the URL on init and exchanges it, consuming the single-use PKCE
// `code_verifier`. The callback page must therefore NOT call
// `exchangeCodeForSession` again — a second exchange fails with
// "PKCE code verifier not found in storage". Instead it just waits for the
// session that the automatic exchange produces.

export type AuthCallbackPlan =
  /** OAuth error came back in the URL — surface it. */
  | { kind: 'error'; message: string }
  /** PKCE/OAuth `?code=` flow: detectSessionInUrl handles the exchange; just wait. */
  | { kind: 'await-detected-session' }
  /** SSO handoff with tokens in the hash: set the session explicitly. */
  | { kind: 'set-session'; accessToken: string; refreshToken: string }
  /** Nothing to process in the link: only valid if a session already exists. */
  | { kind: 'require-existing-session' };

function toParams(raw: string, prefix: '?' | '#'): URLSearchParams {
  const trimmed = raw.startsWith(prefix) ? raw.slice(1) : raw;
  return new URLSearchParams(trimmed);
}

/**
 * Decides how the callback page should complete the auth flow, given the
 * current URL search string and hash fragment.
 */
export function planAuthCallback(search: string, hash: string): AuthCallbackPlan {
  const query = toParams(search, '?');
  const fragment = toParams(hash, '#');

  const errorDescription =
    fragment.get('error_description') || query.get('error_description');
  if (errorDescription) {
    return { kind: 'error', message: errorDescription };
  }

  // PKCE/OAuth first: the SDK will exchange the code on its own.
  if (query.get('code')) {
    return { kind: 'await-detected-session' };
  }

  // SSO handoff: both tokens must be present to set a session.
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'set-session', accessToken, refreshToken };
  }

  return { kind: 'require-existing-session' };
}
