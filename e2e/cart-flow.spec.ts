import { test, expect } from '@playwright/test';
import { mockPublicApi } from './fixtures/publicApi';

const SLUG = process.env.TEST_SLUG || 'casadossalgados';

test.describe('Fluxo de carrinho público', () => {
  test.beforeEach(async ({ page }) => { if (process.env.E2E_LIVE_API !== 'true') await mockPublicApi(page); });
  test('adiciona produtos e cria sessão de carrinho', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    // Tenta adicionar o primeiro produto via aria-label
    const addButton = page.getByRole('button', { name: /^adicionar /i }).first();
    await expect(addButton).toBeVisible({ timeout: 5_000 });
    await addButton.click();

    await page.getByRole('dialog').getByRole('button', { name: 'Adicionar', exact: true }).click();

    // Clica em "Continuar pedido"
    const continueBtn = page.getByRole('button', { name: /ver sacola/i });
    await expect(continueBtn).toBeVisible({ timeout: 10_000 });
    await continueBtn.click();

    // Aguarda navegação para o carrinho
    await page.waitForURL('**/menu/carrinho/**', { timeout: 15_000 });

    // Verifica que a página do carrinho carregou
    await expect(page.getByText('Sua sacola', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Coxinha', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /escolher retirada|agendar retirada/i })).toBeEnabled();
  });
});
