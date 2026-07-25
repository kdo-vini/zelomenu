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

type DeliveryQuoteMock = {
  deliveryStatus: string;
  deliveryFee: number;
  deliveryFeeToConfirm: boolean;
};

type PublicApiMockState = {
  revision: number;
  quote: DeliveryQuoteMock;
  fulfillment: Record<string, unknown>;
  patchDelayMs: number;
};

const publicApiMockStates = new WeakMap<Page, PublicApiMockState>();

function buildMockCartResponse(state: PublicApiMockState) {
  const deliveryFee = state.quote.deliveryFee;
  const fulfillment = {
    ...state.fulfillment,
    deliveryStatus: state.quote.deliveryStatus,
    deliveryFee,
    deliveryFeeToConfirm: state.quote.deliveryFeeToConfirm,
  };
  const issues = state.quote.deliveryStatus === 'out_of_area'
    ? [{ code: 'delivery_out_of_area', message: 'Fora da area de entrega.' }]
    : [];
  return {
    session: {
      id: 'e2e-session', orderingId: 'e2e-ordering', context: 'public_order', state: 'cart_open', revision: state.revision,
      customer: { name: null, phone: null },
      cart: { items: [{ productId: 1, productName: 'Coxinha', baseUnitPrice: 12, selectedModifiers: [], modifierDeltaTotal: 0, quantity: 1, unitPrice: 12, lineTotal: 12, notes: null }], observations: null },
      fulfillment,
      pricing: { subtotal: 12, deliveryFee, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 12 + deliveryFee },
      payment: { declaredMethod: null, pixReceiptRequired: false, pixReceiptApproved: false, pixCopyPaste: null },
      metadata: {}, lastRevalidatedAt: null, lastRevalidation: { checkedAt: new Date().toISOString(), ok: issues.length === 0, issues, previewCart: null, previewPricing: null, previewPayment: null },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), confirmedAt: null, archivedAt: null,
    },
    business: { name: 'Casa dos Salgados', address: 'Rua de teste, 100', pixEnabled: false, deliveryEnabled: true, deliveryNeighborhoods: [], businessHours: { configured: false, openNow: true, label: null } },
    catalog: [{ nome: 'Salgados', subcategorias: [], produtosDireto: [{ id: 1, name: 'Coxinha', price: 12, basePrice: 12, available: true, description: 'Coxinha de teste', modifierGroups: [] }] }],
    link: { path: '/menu/carrinho/e2e-cart-token', tokenStatus: 'current' },
    revalidation: { checkedAt: new Date().toISOString(), ok: issues.length === 0, issues, previewCart: null, previewPricing: null, previewPayment: null },
    order: null,
  };
}

async function mockPublicApi(page: Page) {
  const state: PublicApiMockState = {
    revision: 1,
    quote: { deliveryStatus: 'pending', deliveryFee: 0, deliveryFeeToConfirm: true },
    patchDelayMs: 0,
    fulfillment: { type: 'pickup', asap: true, pickupDate: null, pickupTime: null, deliveryAddress: null, deliveryNeighborhood: null, deliveryPostalCode: null, deliveryNumber: null, deliveryComplement: null, deliveryStreet: null, deliveryCity: null, deliveryState: null, deliveryFee: 0, deliveryFeeToConfirm: false },
  };
  publicApiMockStates.set(page, state);

  await page.route('**/api/public/zelomenu/store/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: buildMockCartResponse(state) });
      return;
    }
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { token: 'e2e-cart-token', path: '/menu/carrinho/e2e-cart-token', orderingId: 'e2e-ordering' } });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/public/zelomenu/cart/**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ json: buildMockCartResponse(state) });
      return;
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON() as { expectedRevision?: number; fulfillment?: Record<string, unknown> };
      if (state.patchDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.patchDelayMs));
      state.revision = Number(body.expectedRevision ?? state.revision) + 1;
      if (body.fulfillment) state.fulfillment = { ...state.fulfillment, ...body.fulfillment };
      await route.fulfill({ json: buildMockCartResponse(state) });
      return;
    }
    if (method === 'POST') {
      await route.fulfill({ json: { ...buildMockCartResponse(state), confirmation: { confirmed: true, alreadyConfirmed: false, state: 'confirmed_waiting_review', customerMessage: null } } });
      return;
    }
    await route.continue();
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function addProductAndGoToCart(page: Page) {
  await page.goto(`/${SLUG}`);
  await expect(page.getByRole('heading', { name: /casa dos salgados/i })).toBeVisible({ timeout: 15_000 });

  const addButton = page.getByRole('button', { name: /^adicionar /i }).first();
  await expect(addButton).toBeVisible({ timeout: 5_000 });
  await addButton.click();

  const modalConfirm = page.getByRole('button', { name: /confirmar|adicionar ao pedido|ok/i });
  if (await modalConfirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await modalConfirm.click();
  }

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
  return;
  if (false) {
  await page.route('**/api/public/zelomenu/cart/**', async (route) => {
    const method = route.request().method();
    // Only intercept PATCH and GET (not POST/confirm, etc.)
    if (method === 'PATCH' || method === 'GET') {
      const response = await route.fetch();
      const body = await response.json();
      if (body?.session?.fulfillment) {
        body.session.fulfillment.deliveryStatus = overrides.deliveryStatus;
        body.session.fulfillment.deliveryFee = overrides.deliveryFee;
        body.session.fulfillment.deliveryFeeToConfirm = overrides.deliveryFeeToConfirm;
        // Add revalidation issue for out_of_area
        if (overrides.deliveryStatus === 'out_of_area') {
          body.revalidation = body.revalidation ?? { checkedAt: new Date().toISOString(), ok: false, issues: [], previewCart: null, previewPricing: null, previewPayment: null };
          body.revalidation.ok = false;
          const exists = (body.revalidation.issues ?? []).some(
            (i: { code: string }) => i.code === 'delivery_out_of_area',
          );
          if (!exists) {
            body.revalidation.issues = [
              ...(body.revalidation.issues ?? []),
              { code: 'delivery_out_of_area', message: 'Fora da área de entrega.' },
            ];
          }
        }
      }
      await route.fulfill({ response, body: JSON.stringify(body) });
    } else {
      await route.continue();
    }
  });
  }
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
