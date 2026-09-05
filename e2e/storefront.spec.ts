import { test, expect } from '@playwright/test';
import { mockPublicApi, updateMockStoreBusiness } from './fixtures/publicApi';

const SLUG = process.env.TEST_SLUG || 'casadossalgados';

test.describe('Vitrine pública', () => {
  test.beforeEach(async ({ page }) => { if (process.env.E2E_LIVE_API !== 'true') await mockPublicApi(page); });
  test('carrega o cardápio com nome e categorias', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    // Pelo menos uma categoria deve aparecer como heading level 2
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  });

  test('mostra capa e as três ações operacionais antes do catálogo', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('img', { name: /capa de casa dos salgados/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /aberto agora/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /entrega: 40 min/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /informações: endereço e contato/i })).toBeVisible();
  });

  test('abre sheets de horário, entrega e informação e restaura o foco', async ({ page }) => {
    await page.goto(`/${SLUG}`);

    const hoursButton = page.getByRole('button', { name: /aberto agora/i });
    await hoursButton.click();
    await expect(page.getByRole('dialog')).toContainText('Horários de funcionamento');
    await expect(page.getByRole('dialog')).toContainText('Domingo');
    await page.keyboard.press('Escape');
    await expect(hoursButton).toBeFocused();

    await page.getByRole('button', { name: /entrega: 40 min/i }).click();
    await expect(page.getByRole('dialog')).toContainText('Taxas por região');
    await expect(page.getByRole('dialog')).toContainText('Centro');
    await page.getByRole('button', { name: 'Fechar informações' }).click();

    await page.getByRole('button', { name: /informações: endereço e contato/i }).click();
    await expect(page.getByRole('dialog')).toContainText('Rua de teste, 100');
    await expect(page.getByRole('dialog').getByRole('link', { name: /como chegar/i })).toHaveAttribute('href', /google\.com\/maps/);
  });

  test('mantém controles públicos com área mínima de toque', async ({ page }) => {
    await page.goto(`/${SLUG}`);
    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

    for (const button of await page.locator('[data-operation], [data-tab]').all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const searchBox = await page.getByLabel('Buscar no cardápio').boundingBox();
    expect(searchBox?.height).toBeGreaterThanOrEqual(44);
  });

  test('explica próxima abertura sem impedir consulta quando a loja está fechada', async ({ page }) => {
    updateMockStoreBusiness(page, {
      businessHours: {
        configured: true,
        openNow: false,
        label: null,
        nextOpen: { day: 'mon', start: '17:00' },
        timezone: 'America/Sao_Paulo',
        weeklySchedule: { sun: [], mon: [{ start: '17:00', end: '23:00' }], tue: [], wed: [], thu: [], fri: [], sat: [] },
        schedulingEnabled: true,
        schedulingLeadTimeMinutes: 30,
      },
    });
    await page.goto(`/${SLUG}`);
    await expect(page.getByText(/loja fechada agora/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /fechado:/i })).toBeVisible();
    await expect(page.getByText('Coxinha', { exact: true })).toBeVisible();
  });

  test('preserva a vitrine quando dados opcionais não estão publicados', async ({ page }) => {
    updateMockStoreBusiness(page, {
      coverUrl: null,
      logoUrl: null,
      whatsapp: null,
      deliveryEstimatedMinutes: null,
      deliveryNeighborhoods: [],
      businessHours: undefined,
    });
    await page.goto(`/${SLUG}`);

    await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('img', { name: /capa de casa dos salgados/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /horários: horário não informado/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /entrega: prazo a confirmar/i })).toBeVisible();
    await page.getByRole('button', { name: /entrega: prazo a confirmar/i }).click();
    await expect(page.getByRole('dialog')).toContainText('A taxa é calculada ao informar o endereço');
  });

  test('funciona sem overflow nos viewports públicos da matriz', async ({ page }) => {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${SLUG}`);
      await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        body: document.documentElement.scrollWidth,
      }));
      expect(dimensions.body, `overflow em ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
      await expect.poll(() => page.locator('#zelomenu-search').evaluate((element) => {
        const sticky = element.closest('.sticky');
        return sticky ? getComputedStyle(sticky).position : 'missing';
      })).toBe('sticky');
    }
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
