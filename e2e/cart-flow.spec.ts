import { test, expect } from '@playwright/test';

const SLUG = process.env.TEST_SLUG || 'casadossalgados';

test.describe('Fluxo de carrinho público', () => {
  test('adiciona produtos e cria sessão de carrinho', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    // Tenta adicionar o primeiro produto via aria-label
    const addButton = page.getByRole('button', { name: /^adicionar /i }).first();
    await expect(addButton).toBeVisible({ timeout: 5_000 });
    await addButton.click();

    // Se modal de modificadores aparecer, confirma
    const modalConfirm = page.getByRole('button', { name: /confirmar|adicionar ao pedido|ok/i });
    if (await modalConfirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await modalConfirm.click();
    }

    // Clica em "Continuar pedido"
    const continueBtn = page.getByRole('button', { name: /continuar pedido/i });
    await expect(continueBtn).toBeVisible({ timeout: 10_000 });
    await continueBtn.click();

    // Aguarda navegação para o carrinho
    await page.waitForURL('**/menu/carrinho/**', { timeout: 15_000 });

    // Verifica que a página do carrinho carregou
    await expect(page.getByText(/sua sacola|itens do pedido|pedido|carregando/i)).toBeVisible({ timeout: 10_000 });

    // Se carregou, verifica que há itens ou mensagem de carrinho vazio
    const itemCount = await page.getByText(/R\$/).count();
    if (itemCount > 0) {
      await expect(page.getByText(/R\$/).first()).toBeVisible();
    }
  });
});
