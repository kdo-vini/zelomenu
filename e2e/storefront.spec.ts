import { test, expect } from '@playwright/test';
import { mockPublicApi } from './fixtures/publicApi';

const SLUG = process.env.TEST_SLUG || 'casadossalgados';

test.describe('Vitrine pública', () => {
  test.beforeEach(async ({ page }) => { if (process.env.E2E_LIVE_API !== 'true') await mockPublicApi(page); });
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

    const products = page.getByRole('button', { name: /^adicionar /i });
    await expect(products.first()).toBeVisible();
    const productCountBefore = await products.count();
    await searchInput.fill('produto-inexistente-xyz');
    await expect(products).toHaveCount(0);
    await searchInput.fill('');
    await expect(products).toHaveCount(productCountBefore);
  });

  test('adiciona produto ao carrinho e exibe barra inferior', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    // Tenta adicionar o primeiro produto pelo aria-label "Adicionar ..."
    const addButton = page.getByRole('button', { name: /^adicionar /i }).first();
    await addButton.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Adicionar', exact: true }).click();

    // Barra inferior com "Continuar pedido" deve aparecer
    await expect(page.getByRole('button', { name: /ver sacola/i })).toBeVisible({ timeout: 10_000 });
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
