import { test, expect } from '@playwright/test';

const EMAIL = process.env.TEST_EMAIL || '';
const PASSWORD = process.env.TEST_PASSWORD || '';

test.describe('Login com email/senha', () => {
  test.skip(!EMAIL || !PASSWORD, 'TEST_EMAIL e TEST_PASSWORD precisam estar definidos no .env');

  test('login completo redireciona para o admin', async ({ page }) => {
    await page.goto(`/admin`);

    // Aguarda o formulário de login carregar
    await expect(page.getByRole('heading', { name: 'ZeloMenu' })).toBeVisible({ timeout: 15_000 });

    // Preenche email e senha
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Senha').fill(PASSWORD);

    // Clica em Entrar (exact para não conflitar com "Entrar com Google")
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    // Aguarda redirecionamento para /admin — se o login for bem-sucedido,
    // o AdminPage renderiza o AdminLayout com sidebar
    await page.waitForURL('**/admin', { timeout: 15_000 });

    // Verifica que o admin carregou (sidebar com "Cardápio" ou "Publicação")
    // O AdminLayout pode mostrar nav items ou o OnboardingWizard
    await expect(
      page.getByText(/cardápio|publicação|bem-vindo/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('mostra erro com credenciais inválidas', async ({ page }) => {
    await page.goto(`/admin`);

    // Aguarda o formulário de login carregar
    await expect(page.getByRole('heading', { name: 'ZeloMenu' })).toBeVisible({ timeout: 15_000 });

    // Preenche credenciais inválidas
    await page.getByLabel('Email').fill('invalido@teste.com');
    await page.getByLabel('Senha').fill('senha_errada');

    // Clica em Entrar (exact para não conflitar com "Entrar com Google")
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();

    // Verifica mensagem de erro
    await expect(page.getByText(/inválido|erro/i)).toBeVisible({ timeout: 10_000 });
  });
});
