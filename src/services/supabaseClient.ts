import { createClient } from '@supabase/supabase-js';

// Standalone Supabase client for the ZeloMenu owner-config app. This is NOT
// shared with ZeloChat — it is our own client. It reads the same Supabase
// project (shared by ZeloPDV / ZeloChat) via the public anon key.
//
// TODO: cross-subdomain cookie storage on .zelopdv.com.br for SSO. Today this
// uses @supabase/supabase-js defaults (localStorage persistence), which means
// the session is NOT shared with the PDV/Chat apps across subdomains. The
// product decision is that auth comes from the PDV/Chat session, so a later
// task must swap the auth storage for a cookie-based store scoped to
// .zelopdv.com.br (and add the SSO handshake). Do not implement that here.

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

const supabaseUrl = env?.VITE_SUPABASE_URL;
const supabaseAnonKey = env?.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Keep the app booting in dev, but make the misconfiguration obvious on use.
  console.warn(
    '[Supabase] Variáveis ausentes: VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY. ' +
      'Configure em .env (veja .env.example).',
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'http://127.0.0.1:54321',
  supabaseAnonKey ?? 'public-anon-key-placeholder',
);
