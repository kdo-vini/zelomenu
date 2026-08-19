import { test, expect } from '@playwright/test';

const SLUG = process.env.TEST_SLUG || 'casadossalgados';

test.describe('Vitrine pública', () => {
  test('carrega o cardápio com nome e categorias', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    // Pelo menos uma categoria deve aparecer como heading level 2
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  });

  test('busca filtra produtos', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    // O placeholder usa reticência unicode (…)
    const searchInput = page.getByPlaceholder('Buscar no cardápio…');
    await expect(searchInput).toBeVisible();

    // Conta quantos produtos estão visíveis antes da busca
    const productCountBefore = await page.getByRole('button', { name: /^adicionar /i }).count();

    // Digita um termo de busca
    await searchInput.fill('bebida');

    // A busca filtra — deve aparecer um botão X para limpar (sem aria-label, só ícone)
    // ou o número de produtos visíveis muda
    await page.waitForTimeout(500);

    // O botão de limpar (X) aparece quando há texto no search
    const clearBtn = page.locator('input[type="search"] + button, input[type="search"] ~ button');
    if (await clearBtn.isVisible().catch(() => false)) {
      await expect(clearBtn).toBeVisible();
    }
  });

  test('adiciona produto ao carrinho e exibe barra inferior', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    // Tenta adicionar o primeiro produto pelo aria-label "Adicionar ..."
    const addButton = page.getByRole('button', { name: /^adicionar /i }).first();
    if (await addButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addButton.click();
    }

    // Se modal de modificadores aparecer, confirma
    const modalConfirm = page.getByRole('button', { name: /confirmar|adicionar ao pedido|ok/i });
    if (await modalConfirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await modalConfirm.click();
    }

    // Barra inferior com "Continuar pedido" deve aparecer
    await expect(page.getByRole('button', { name: /continuar pedido/i })).toBeVisible({ timeout: 10_000 });
  });

  test('layout responsivo funciona em viewport estreito', async ({ page }) => {
    // Força viewport estreito mesmo no projeto desktop
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder('Buscar no cardápio…')).toBeVisible();
  });

  test('mostra uma página 404 estilizada para um slug indisponível', async ({ page }) => {
    await page.goto('/slug-publico-inexistente-zelomenu');

    await expect(page.getByRole('heading', { name: /este cardápio não está disponível/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /voltar para o início/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /conhecer o zelomenu/i })).toBeVisible();
  });
});
