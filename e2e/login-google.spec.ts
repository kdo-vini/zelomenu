import { test, expect } from '@playwright/test';

test.describe('Fluxo de login com Google', () => {
  test('renderiza o formulário de login e o botão "Entrar com Google"', async ({ page }) => {
    await page.goto(`/admin`);

    // Aguarda o LoginForm renderizar (h1 "ZeloMenu" + botão Google)
    await expect(page.getByRole('heading', { name: 'ZeloMenu' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible();
  });

  test('solicita Google OAuth com redirectTo correto', async ({ page }) => {
    // Validate the client contract without navigating to a real OAuth provider.
    await page.route('**/auth/v1/authorize?**', (route) => route.fulfill({ status: 200, body: 'OAuth test boundary' }));
    // Intercepta a requisição de authorize do Supabase antes do redirect
    const requestPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/auth/v1/authorize') &&
        req.url().includes('provider=google'),
      { timeout: 15_000 },
    );

    await page.goto(`/admin`);

    // Aguarda o LoginForm carregar
    await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible({ timeout: 15_000 });

    // Clica no botão Google
    await page.getByRole('button', { name: 'Entrar com Google' }).click();

    // Verifica a requisição de authorize
    const request = await requestPromise;
    const reqUrl = new URL(request.url());
    expect(reqUrl.searchParams.get('provider')).toBe('google');

    // O parâmetro redirect_to pode estar em query string ou no body
    const redirectTo = reqUrl.searchParams.get('redirect_to');
    expect(redirectTo).toBeTruthy();
    const redirectUrl = new URL(redirectTo!);
    expect(redirectUrl.pathname).toBe('/auth/callback');
    expect(redirectUrl.searchParams.get('next')).toBe('/admin');
  });
});
