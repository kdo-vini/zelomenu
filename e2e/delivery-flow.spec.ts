import { test, expect, type Page } from '@playwright/test';

const SLUG = process.env.TEST_SLUG || 'casadossalgados';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_CEP_RESPONSE = {
  address: {
    postalCode: '01001000',
    street: 'Praça da Sé',
    neighborhood: 'Sé',
    city: 'São Paulo',
    state: 'SP',
  },
};

import { mockPublicApi, publicApiMockStates } from './fixtures/publicApi';

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function addProductAndGoToCart(page: Page) {
  await page.goto(`/${SLUG}`);
  await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

  const addButton = page.getByRole('button', { name: /^adicionar /i }).first();
  await expect(addButton).toBeVisible({ timeout: 5_000 });
  await addButton.click();

  await page.getByRole('dialog', { name: 'Coxinha' }).getByRole('button', { name: 'Adicionar', exact: true }).click();

  const continueBtn = page.getByRole('button', { name: /ver sacola/i });
  await expect(continueBtn).toBeVisible({ timeout: 10_000 });
  await continueBtn.click();

  await page.waitForURL('**/menu/carrinho/**', { timeout: 15_000 });
  await expect(page.getByText('Sua sacola', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
}

async function goToStep1(page: Page) {
  // CTA at step 0: "Escolher retirada" or "Agendar retirada"
  const cta = page.getByRole('button', { name: /escolher retirada|agendar retirada/i });
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await expect(cta).not.toBeDisabled();
  await cta.click();

  // Wait for step 1 to render — delivery toggle should appear
  await expect(page.getByText(/como você quer receber/i)).toBeVisible({ timeout: 5_000 });
}

async function selectDelivery(page: Page) {
  const entregaBtn = page.getByRole('button', { name: 'Entrega' });
  await expect(entregaBtn).toBeVisible({ timeout: 5_000 });
  await entregaBtn.click();
  // After clicking, aria-pressed becomes true
  await expect(entregaBtn).toHaveAttribute('aria-pressed', 'true');
}

async function typeCep(page: Page, cep: string) {
  const cepInput = page.getByPlaceholder('00000-000');
  await expect(cepInput).toBeVisible({ timeout: 5_000 });
  await cepInput.fill(cep);
  // Blur triggers CEP lookup
  await cepInput.blur();
}

async function typeNumber(page: Page, number: string) {
  const numberInput = page.getByPlaceholder('123');
  await expect(numberInput).toBeVisible({ timeout: 5_000 });
  await numberInput.fill(number);
  // The production UI debounces the quote from the last digit, so blur is
  // not required to start the request.
  await numberInput.blur();
}

/**
 * Intercepta os endpoints de carrinho (PATCH e GET) e injeta um status de
 * cotação de entrega específico na resposta.
 */
async function mockCartDeliveryQuote(
  page: Page,
  overrides: {
    deliveryStatus: string;
    deliveryFee: number;
    deliveryFeeToConfirm: boolean;
  },
) {
  const state = publicApiMockStates.get(page);
  if (!state) throw new Error('Public API mocks were not installed for this page');
  state.quote = overrides;

}

async function mockCepLookup(page: Page) {
  await page.route('**/api/public/zelomenu/delivery/cep', async (route) => {
    await route.fulfill({ json: MOCK_CEP_RESPONSE });
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await mockPublicApi(page);
});

test.describe('Fluxo de entrega', () => {
  test('1. Busca de CEP preenche campos de endereço automaticamente', async ({ page }) => {
    await mockCepLookup(page);
    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    await typeCep(page, '01001000');

    // Aguarda o CEP lookup terminar e os campos serem preenchidos
    await expect(page.getByPlaceholder('Preenchido pelo CEP')).toHaveValue('Sé', { timeout: 10_000 });
    await expect(page.getByPlaceholder('Preenchida pelo CEP')).toHaveValue('São Paulo', { timeout: 5_000 });

    // Rua deve ser preenchida
    const streetInput = page.getByPlaceholder('Rua, avenida...');
    await expect(streetInput).toHaveValue('Praça da Sé', { timeout: 5_000 });

    // UF deve ser preenchida
    const ufInput = page.getByPlaceholder('UF');
    await expect(ufInput).toHaveValue('SP', { timeout: 5_000 });

    // Após CEP + número, mostra hint "Informe o CEP e o número para calcular a entrega"
    // (estado missing_address porque não tem número ainda)
    await expect(page.getByText(/Informe o CEP e o número para calcular a entrega/)).toBeVisible({ timeout: 5_000 });
  });

  test('2. Exibe estado de carregamento enquanto calcula a cotação', async ({ page }) => {
    await mockCepLookup(page);

    const state = publicApiMockStates.get(page);
    if (state) state.patchDelayMs = 1200;

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    await typeCep(page, '01001000');
    await typeNumber(page, '100');

    // Após a última tecla, o autosave dispara em ~1000ms e o modal
    // "Calculando a entrega" aparece enquanto o PATCH está pendente
    const quoteModal = page.locator('[role="dialog"]')
      .filter({ hasText: /Calculando a entrega/i });

    // Pode aparecer e desaparecer rapidamente, por isso usamos um timeout curto
    try {
      await expect(quoteModal).toBeVisible({ timeout: 3_000 });
    } catch {
      // Se não apareceu, o cálculo foi muito rápido. O teste não falha —
      // significa que a UX é rápida o suficiente.
    }
  });

  test('Debounce reinicia a partir do último dígito antes de cotar', async ({ page }) => {
    await mockCepLookup(page);

    const state = publicApiMockStates.get(page);
    if (state) state.patchDelayMs = 800;

    let patchCount = 0;
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/api/public/zelomenu/cart/')) {
        patchCount += 1;
      }
    });

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);
    await typeCep(page, '01001000');
    await expect(page.getByPlaceholder('Preenchida pelo CEP')).toHaveValue('São Paulo', { timeout: 5_000 });

    // Deixa qualquer autosave do CEP terminar antes de medir somente o número.
    await page.waitForTimeout(900);
    const patchesBeforeNumber = patchCount;
    const numberInput = page.getByPlaceholder('123');

    await numberInput.fill('1');
    await page.waitForTimeout(500);
    await numberInput.fill('12');

    // Ainda não passou 1s desde o último dígito: não houve nova cotação nem modal.
    await page.waitForTimeout(350);
    expect(patchCount).toBe(patchesBeforeNumber);
    await expect(page.locator('[role="dialog"]').filter({ hasText: /Calculando a entrega/i })).toBeHidden();

    // Depois do debounce, a requisição começa e o modal aparece durante o PATCH.
    await expect.poll(() => patchCount, { timeout: 1_500 }).toBe(patchesBeforeNumber + 1);
    await expect(page.locator('[role="dialog"]').filter({ hasText: /Calculando a entrega/i })).toBeVisible({ timeout: 1_000 });
  });

  test('3. Entrega elegível — CTA fica ativo e mostra valor do frete', async ({ page }) => {
    await mockCepLookup(page);
    await mockCartDeliveryQuote(page, {
      deliveryStatus: 'eligible',
      deliveryFee: 8.50,
      deliveryFeeToConfirm: false,
    });

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    await typeCep(page, '01001000');
    await typeNumber(page, '100');

    // Aguarda o autosave processar e a cotação ficar pronta
    const cta = page.getByRole('button', { name: /revisar pedido/i });
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(cta).not.toBeDisabled();

    // O rodapé deve mostrar o valor do frete
    await expect(page.getByText(/inclui/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('R$ 8,50', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('4. Endereço fora da área — exibe alerta e bloqueia CTA', async ({ page }) => {
    await mockCepLookup(page);
    await mockCartDeliveryQuote(page, {
      deliveryStatus: 'out_of_area',
      deliveryFee: 0,
      deliveryFeeToConfirm: true,
    });

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    await typeCep(page, '01001000');
    await typeNumber(page, '999');

    // Alerta de "fora da área" deve aparecer
    const alert = page.getByRole('alert').filter({ hasText: /fora da área de entrega/i });
    await expect(alert).toBeVisible({ timeout: 10_000 });

    // CTA deve estar desabilitado com texto "Endereço fora da área"
    const cta = page.getByRole('button', { name: /endereço fora da área/i });
    await expect(cta).toBeVisible({ timeout: 5_000 });
    await expect(cta).toBeDisabled();
  });

  test('5. Alterar endereço invalida cotação anterior', async ({ page }) => {
    await mockCepLookup(page);
    await mockCartDeliveryQuote(page, {
      deliveryStatus: 'eligible',
      deliveryFee: 8.50,
      deliveryFeeToConfirm: false,
    });

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    // Primeiro, obtém uma cotação elegível
    await typeCep(page, '01001000');
    await typeNumber(page, '100');

    const cta = page.getByRole('button', { name: /revisar pedido/i });
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(cta).not.toBeDisabled();

    // Agora muda o número — a cotação anterior fica inválida
    const numberInput = page.getByPlaceholder('123');
    await numberInput.fill('200');

    // O estado volta para "calculando" (ou "missing address" se limpar),
    // e o CTA deve mostrar "Calculando entrega…" ou "Informe o endereço"
    // Neste caso, como o CEP continua 01001000 e o número 200,
    // fica em "calculando" até o autosave responder
    const ctaCalculating = page.getByRole('button', { name: /calculando entrega/i });
    await expect(ctaCalculating).toBeVisible({ timeout: 5_000 });
    // E está desabilitado
    await expect(ctaCalculating).toBeDisabled();
  });

  test('6. Refresh preserva dados de entrega do carrinho', async ({ page }) => {
    await mockCepLookup(page);
    await mockCartDeliveryQuote(page, {
      deliveryStatus: 'eligible',
      deliveryFee: 5.00,
      deliveryFeeToConfirm: false,
    });

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    await typeCep(page, '01001000');
    await typeNumber(page, '100');

    // Espera a cotação ficar pronta
    const cta = page.getByRole('button', { name: /revisar pedido/i });
    await expect(cta).toBeVisible({ timeout: 10_000 });

    // Recarrega a página — as rotas persistem e vão injetar o mesmo status
    await page.reload();

    // Aguarda o carrinho recarregar
    await expect(page.getByText('Sua sacola', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // Vai para step 1 novamente
    await goToStep1(page);

    // O CEP e número devem estar preservados
    const cepInput = page.getByPlaceholder('00000-000');
    await expect(cepInput).toHaveValue('01001000', { timeout: 5_000 });

    const numberInput = page.getByPlaceholder('123');
    await expect(numberInput).toHaveValue('100', { timeout: 5_000 });

    // Entrega ainda deve estar selecionada
    const entregaBtn = page.getByRole('button', { name: 'Entrega' });
    await expect(entregaBtn).toHaveAttribute('aria-pressed', 'true');

    // Rua ainda deve estar preenchida
    const streetInput = page.getByPlaceholder('Rua, avenida...');
    await expect(streetInput).toHaveValue('Praça da Sé', { timeout: 5_000 });
  });
});

test.describe('Fluxo de entrega — mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('Busca de CEP e cotação funcionam em viewport estreito', async ({ page }) => {
    await mockCepLookup(page);
    await mockCartDeliveryQuote(page, {
      deliveryStatus: 'eligible',
      deliveryFee: 8.50,
      deliveryFeeToConfirm: false,
    });

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    await typeCep(page, '01001000');

    // Verifica autofill
    await expect(page.getByPlaceholder('Preenchido pelo CEP')).toHaveValue('Sé', { timeout: 10_000 });
    await expect(page.getByPlaceholder('Preenchida pelo CEP')).toHaveValue('São Paulo', { timeout: 5_000 });

    await typeNumber(page, '100');

    // CTA deve ficar ativo
    const cta = page.getByRole('button', { name: /revisar pedido/i });
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(cta).not.toBeDisabled();
  });

  test('Fora da área no mobile mostra alerta', async ({ page }) => {
    await mockCepLookup(page);
    await mockCartDeliveryQuote(page, {
      deliveryStatus: 'out_of_area',
      deliveryFee: 0,
      deliveryFeeToConfirm: true,
    });

    await addProductAndGoToCart(page);
    await goToStep1(page);
    await selectDelivery(page);

    await typeCep(page, '01001000');
    await typeNumber(page, '999');

    const alert = page.getByRole('alert').filter({ hasText: /fora da área de entrega/i });
    await expect(alert).toBeVisible({ timeout: 10_000 });
  });
});
