import { test, expect } from '@playwright/test';

test.describe('AuthCallbackPage', () => {
  test('exibe erro de sessao ao receber code invalido', async ({ page }) => {
    await page.goto(`/auth/callback?code=fake-test-code&next=/admin`);

    // O código falso não completa a sessão: a página cai no estado de erro
    // (falha rápida ou timeout de espera da sessão). O título é um <h1>, então
    // usamos o role heading para não colidir com a descrição, que repete a frase.
    await expect(
      page.getByRole('heading', { name: 'Não foi possível concluir o login' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('exibe erro quando nao ha code nem tokens', async ({ page }) => {
    await page.goto(`/auth/callback`);

    // Deve mostrar erro informando que nao ha codigo
    await expect(
      page.getByText('Nenhum código de autenticação encontrado no link'),
    ).toBeVisible({ timeout: 15_000 });
  });
});
