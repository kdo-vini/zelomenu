import { describe, expect, it } from 'vitest';
import { planAuthCallback } from './authCallback';

describe('planAuthCallback', () => {
  it('aguarda a sessão detectada em vez de trocar o código no fluxo PKCE/OAuth', () => {
    // Regressão: com `detectSessionInUrl` ligado, o supabase-js já troca o
    // `?code=` automaticamente e consome o code_verifier (uso único). Trocar
    // manualmente aqui causava "PKCE code verifier not found in storage".
    // O plano correto é apenas aguardar a sessão, nunca trocar de novo.
    expect(planAuthCallback('?code=abc123&next=/admin', '')).toEqual({
      kind: 'await-detected-session',
    });
  });

  it('usa setSession quando o handoff SSO traz tokens no hash', () => {
    const plan = planAuthCallback(
      '',
      '#access_token=at-token&refresh_token=rt-token&token_type=bearer',
    );
    expect(plan).toEqual({
      kind: 'set-session',
      accessToken: 'at-token',
      refreshToken: 'rt-token',
    });
  });

  it('prioriza o fluxo PKCE sobre tokens de hash quando ambos aparecem', () => {
    const plan = planAuthCallback('?code=abc123', '#access_token=x&refresh_token=y');
    expect(plan).toEqual({ kind: 'await-detected-session' });
  });

  it('sinaliza erro quando error_description vem na query', () => {
    const plan = planAuthCallback('?error_description=acesso%20negado', '');
    expect(plan).toEqual({ kind: 'error', message: 'acesso negado' });
  });

  it('sinaliza erro quando error_description vem no hash', () => {
    const plan = planAuthCallback('', '#error_description=token%20expirado');
    expect(plan).toEqual({ kind: 'error', message: 'token expirado' });
  });

  it('exige sessão existente quando não há nada para processar no link', () => {
    expect(planAuthCallback('', '')).toEqual({ kind: 'require-existing-session' });
    expect(planAuthCallback('?next=/admin', '')).toEqual({
      kind: 'require-existing-session',
    });
  });

  it('ignora hash com apenas um dos tokens (par incompleto)', () => {
    expect(planAuthCallback('', '#access_token=only-access')).toEqual({
      kind: 'require-existing-session',
    });
    expect(planAuthCallback('', '#refresh_token=only-refresh')).toEqual({
      kind: 'require-existing-session',
    });
  });
});
