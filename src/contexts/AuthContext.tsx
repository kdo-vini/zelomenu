import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

// Minimal auth provider for the ZeloMenu config app. There is exactly one
// supabase.auth subscription in the app, and it lives here.
//
// Per the product decision, this app has NO login screen — the session is
// expected to already exist (set by the PDV/Chat apps). This provider only
// observes the current Supabase session.
//
// TODO: cookie-SSO handshake + redirect from PDV/Chat. Until cross-subdomain
// cookie storage is wired up (see services/supabaseClient.ts), getSession()
// only sees a localStorage session local to this origin.

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the initial getSession() resolves. */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
