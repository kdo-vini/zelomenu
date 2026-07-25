import { createBrowserClient } from '@supabase/ssr';

// Supabase client with cookie-based auth storage. In production, cookies share
// the `.zelopdv.com.br` parent domain so a session created in PDV/Chat is
// visible in the menu app. Localhost must use host-only cookies: browsers
// reject a `.zelopdv.com.br` cookie from `localhost`, which otherwise makes a
// direct local login look successful and then silently loses the token on the
// first authenticated query.

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

// Runtime fallback: the Express server injects window.__ENV__ into the HTML
// so the frontend can pick up VITE_SUPABASE_* from the server's process.env
// without needing Docker --build-arg.
const runtimeEnv: Record<string, string> | undefined =
  typeof window !== 'undefined'
    ? (window as unknown as { __ENV__?: Record<string, string> }).__ENV__
    : undefined;

const supabaseUrl = env?.VITE_SUPABASE_URL || runtimeEnv?.VITE_SUPABASE_URL;
const supabaseAnonKey = env?.VITE_SUPABASE_ANON_KEY || runtimeEnv?.VITE_SUPABASE_ANON_KEY;
const currentHostname = typeof location !== 'undefined' ? location.hostname : '';
const isZeloPdvHost = currentHostname === 'zelopdv.com.br' || currentHostname.endsWith('.zelopdv.com.br');

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Variáveis ausentes: VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY. ' +
      'Configure em .env (veja .env.example).',
  );
}

export const supabase = createBrowserClient(
  supabaseUrl ?? 'http://127.0.0.1:54321',
  supabaseAnonKey ?? 'public-anon-key-placeholder',
  {
    cookieOptions: {
      ...(isZeloPdvHost ? { domain: '.zelopdv.com.br' } : {}),
      // SameSite Lax allows the cookie to be sent when navigating from
      // another subdomain (e.g., chat → menu).
      sameSite: 'lax',
      // Secure in production where HTTPS is available, false for local dev (http://localhost)
      secure: typeof location !== 'undefined' ? location.protocol === 'https:' : true,
    },
  },
);
