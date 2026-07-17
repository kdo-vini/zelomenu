# WhatsApp "Enviar pedido" na comprovação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar, na tela de comprovação do pedido, um botão que abre o WhatsApp da loja com o resumo do pedido preenchido, para pedidos públicos.

**Architecture:** O número da loja (`empresa_perfil.contato`) é normalizado no servidor e exposto como `business.whatsapp` na resposta pública (loja e carrinho). A tela de comprovação monta a mensagem a partir do payload que já tem em mãos, via helpers puros no `src/domain/`, e renderiza um link `wa.me`.

**Tech Stack:** React 19 + TypeScript, Express (tsx em produção), Supabase, vitest.

## Global Constraints

- UI e mensagens em PT-BR.
- Botão só em `context === 'public_order'`; mesa (`table_order`) não muda.
- Sem número válido → botão oculto; mantém só "Voltar ao cardápio".
- Cores/estilo do botão usam a identidade Zelo (`--color-brand`), NUNCA o verde do WhatsApp (regra do PRODUCT.md: não confundir identidade Zelo com a do WhatsApp).
- Server (`server/**`) fica fora do `tsc` (tsconfig include = `src`, `vite.config.ts`); validar server via esbuild/tsx.
- Mensagem inclui o NOME do cliente, nunca o telefone.
- Commits frequentes; não fazer push (deploy é manual).

---

### Task 1: Helper `toWhatsAppNumber` (domain, puro)

**Files:**
- Create: `src/domain/whatsappOrder.ts`
- Test: `src/domain/whatsappOrder.test.ts`

**Interfaces:**
- Produces: `toWhatsAppNumber(raw: string | null | undefined): string | null`
  — retorna número só-dígitos com DDI (`55XXXXXXXXXX`) ou `null`.

- [ ] **Step 1: Escrever o teste que falha**

Create `src/domain/whatsappOrder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toWhatsAppNumber } from './whatsappOrder';

describe('toWhatsAppNumber', () => {
  it('normaliza número com máscara (sem DDI) para 55 + nacional', () => {
    expect(toWhatsAppNumber('(11) 99999-9999')).toBe('5511999999999');
  });

  it('normaliza número só com dígitos de 11 e 10', () => {
    expect(toWhatsAppNumber('11999999999')).toBe('5511999999999');
    expect(toWhatsAppNumber('1133334444')).toBe('551133334444');
  });

  it('mantém DDI 55 já presente', () => {
    expect(toWhatsAppNumber('5511999999999')).toBe('5511999999999');
    expect(toWhatsAppNumber('+55 (11) 99999-9999')).toBe('5511999999999');
  });

  it('remove prefixo internacional 00', () => {
    expect(toWhatsAppNumber('005511999999999')).toBe('5511999999999');
  });

  it('rejeita números inválidos e vazios', () => {
    expect(toWhatsAppNumber('123')).toBeNull();
    expect(toWhatsAppNumber('55123')).toBeNull();
    expect(toWhatsAppNumber('')).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
    expect(toWhatsAppNumber(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/domain/whatsappOrder.test.ts`
Expected: FAIL — `Failed to load url ./whatsappOrder` (arquivo não existe).

- [ ] **Step 3: Implementar o helper**

Create `src/domain/whatsappOrder.ts`:

```ts
// Helpers puros para o botão "Enviar pedido no WhatsApp".
// Sem dependências de React/DB — compartilhado entre cliente e servidor.

/**
 * Normaliza um telefone brasileiro para o formato aceito pelo wa.me:
 * só dígitos, com DDI 55. Espelha normalizeBrazilianPhone do ZeloPDV.
 * Retorna null quando não dá para formar um número válido.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('55')) {
    const national = digits.slice(2);
    if (national.length === 10 || national.length === 11) return `55${national}`;
    return null;
  }
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/domain/whatsappOrder.test.ts`
Expected: PASS (todos os casos de `toWhatsAppNumber`).

- [ ] **Step 5: Commit**

```bash
git add src/domain/whatsappOrder.ts src/domain/whatsappOrder.test.ts
git commit -m "feat(whatsapp): helper toWhatsAppNumber para normalizar número da loja"
```

---

### Task 2: Helpers de mensagem e link (domain, puro)

**Files:**
- Modify: `src/domain/whatsappOrder.ts`
- Test: `src/domain/whatsappOrder.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `type WhatsAppOrderItem = { name: string; quantity: number; lineTotal: number }`
  - `type WhatsAppOrderInput = { orderId: string; customerName: string | null; items: WhatsAppOrderItem[]; subtotal: number; total: number; feeToConfirm: boolean; isDelivery: boolean; whenLabel: string; deliveryAddress?: string | null; deliveryNeighborhood?: string | null; observations?: string | null }`
  - `buildWhatsAppOrderMessage(input: WhatsAppOrderInput): string`
  - `buildWhatsAppOrderLink(whatsapp: string, message: string): string`

- [ ] **Step 1: Escrever os testes que falham**

Append to `src/domain/whatsappOrder.test.ts`:

```ts
import { buildWhatsAppOrderMessage, buildWhatsAppOrderLink } from './whatsappOrder';

describe('buildWhatsAppOrderMessage', () => {
  const base = {
    orderId: 'a1b2c3d4e5',
    customerName: 'João Silva',
    items: [
      { name: 'Coxinha', quantity: 2, lineTotal: 12 },
      { name: 'Refrigerante lata', quantity: 1, lineTotal: 6 },
    ],
    subtotal: 18,
    total: 18,
    feeToConfirm: false,
    isDelivery: false,
    whenLabel: 'o quanto antes',
    observations: 'sem cebola',
  };

  it('monta retirada com nome, itens, total e observações', () => {
    const msg = buildWhatsAppOrderMessage(base);
    expect(msg).toContain('Pedido #A1B2C3D4');
    expect(msg).toContain('Cliente: João Silva');
    expect(msg).toContain('• 2x Coxinha');
    expect(msg).toContain('• 1x Refrigerante lata');
    expect(msg).toContain('Total:');
    expect(msg).toContain('Retirada · o quanto antes');
    expect(msg).toContain('Obs.: sem cebola');
    expect(msg).not.toContain('Endereço:');
  });

  it('omite a linha de cliente quando não há nome', () => {
    const msg = buildWhatsAppOrderMessage({ ...base, customerName: null });
    expect(msg).not.toContain('Cliente:');
  });

  it('mostra subtotal + entrega a confirmar quando feeToConfirm', () => {
    const msg = buildWhatsAppOrderMessage({ ...base, feeToConfirm: true });
    expect(msg).toContain('Subtotal:');
    expect(msg).toContain('entrega a confirmar');
    expect(msg).not.toContain('Total:');
  });

  it('inclui endereço e bairro em delivery', () => {
    const msg = buildWhatsAppOrderMessage({
      ...base,
      isDelivery: true,
      whenLabel: 'hoje às 20:00',
      deliveryAddress: 'Rua X, 100',
      deliveryNeighborhood: 'Centro',
    });
    expect(msg).toContain('Entrega · hoje às 20:00');
    expect(msg).toContain('Endereço: Rua X, 100, Centro');
  });
});

describe('buildWhatsAppOrderLink', () => {
  it('monta link wa.me com a mensagem codificada', () => {
    const link = buildWhatsAppOrderLink('5511999999999', 'Olá loja');
    expect(link).toBe('https://wa.me/5511999999999?text=Ol%C3%A1%20loja');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/domain/whatsappOrder.test.ts`
Expected: FAIL — `buildWhatsAppOrderMessage is not a function` / `buildWhatsAppOrderLink is not a function`.

- [ ] **Step 3: Implementar os helpers**

Append to `src/domain/whatsappOrder.ts`:

```ts
export type WhatsAppOrderItem = {
  name: string;
  quantity: number;
  lineTotal: number;
};

export type WhatsAppOrderInput = {
  orderId: string;
  customerName: string | null;
  items: WhatsAppOrderItem[];
  subtotal: number;
  total: number;
  feeToConfirm: boolean;
  isDelivery: boolean;
  whenLabel: string;
  deliveryAddress?: string | null;
  deliveryNeighborhood?: string | null;
  observations?: string | null;
};

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function buildWhatsAppOrderMessage(input: WhatsAppOrderInput): string {
  const lines: string[] = [];
  lines.push('Olá! Segue meu pedido pelo cardápio digital.');
  lines.push('');

  lines.push(`Pedido #${input.orderId.slice(0, 8).toUpperCase()}`);
  const name = input.customerName?.trim();
  if (name) lines.push(`Cliente: ${name}`);
  lines.push('');

  for (const item of input.items) {
    lines.push(`• ${item.quantity}x ${item.name} — ${formatBRL(item.lineTotal)}`);
  }
  lines.push('');

  lines.push(
    input.feeToConfirm
      ? `Subtotal: ${formatBRL(input.subtotal)} + entrega a confirmar`
      : `Total: ${formatBRL(input.total)}`,
  );
  lines.push(`${input.isDelivery ? 'Entrega' : 'Retirada'} · ${input.whenLabel}`);

  const address = input.deliveryAddress?.trim();
  if (input.isDelivery && address) {
    const bairro = input.deliveryNeighborhood?.trim();
    lines.push(`Endereço: ${address}${bairro ? `, ${bairro}` : ''}`);
  }

  const obs = input.observations?.trim();
  if (obs) lines.push(`Obs.: ${obs}`);

  return lines.join('\n');
}

export function buildWhatsAppOrderLink(whatsapp: string, message: string): string {
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/domain/whatsappOrder.test.ts`
Expected: PASS (todos os describes).

- [ ] **Step 5: Commit**

```bash
git add src/domain/whatsappOrder.ts src/domain/whatsappOrder.test.ts
git commit -m "feat(whatsapp): buildWhatsAppOrderMessage e buildWhatsAppOrderLink"
```

---

### Task 3: Backend — expor `business.whatsapp`

**Files:**
- Modify: `server/configStore.ts` (select de `empresa_perfil` + `BusinessConfig.contato`)
- Modify: `server/zelomenuCartSessions.ts` (tipo `business` + 2 construtores + import)

**Interfaces:**
- Consumes: `toWhatsAppNumber` de `../src/domain/whatsappOrder.js`
- Produces: campo `whatsapp: string | null` no objeto `business` de `PublicCartResponse` (herdado por `PublicStoreResponse`).

- [ ] **Step 1: Adicionar `contato` ao carregamento do perfil**

In `server/configStore.ts`, no `select` de `empresa_perfil` dentro de `loadCatalogFromDb` (atualmente `.select('user_id, nome_exibicao, endereco, delivery_config, pix_receipt_config, horario_abertura, horario_fechamento, dias_fechamento, timezone')`), acrescentar `contato`:

```ts
    .select('user_id, nome_exibicao, endereco, contato, delivery_config, pix_receipt_config, horario_abertura, horario_fechamento, dias_fechamento, timezone')
```

No tipo do `row` logo abaixo, adicionar:

```ts
    contato?: string | null;
```

- [ ] **Step 2: Adicionar `contato` ao `BusinessConfig` e preencher**

In `server/configStore.ts`, no tipo `BusinessConfig` (após `address: string;`), adicionar:

```ts
  contato: string | null;
```

E onde o `BusinessConfig` é montado a partir do `row` (o objeto que já preenche `name`, `address`, `pixReceiptConfig`, etc.), adicionar:

```ts
    contato: normalizeText(row.contato),
```

(Se `normalizeText` retornar `string` vazio em vez de `null`, usar `normalizeText(row.contato) || null`. Confirme a assinatura de `normalizeText` no arquivo e mantenha o mesmo padrão dos campos vizinhos como `endereco`.)

- [ ] **Step 3: Importar `toWhatsAppNumber` e adicionar `whatsapp` ao tipo business**

In `server/zelomenuCartSessions.ts`, adicionar o import junto aos demais imports de domain (perto de `import { normalizeComparableText } from '../src/domain/pixReceipt.js';`):

```ts
import { toWhatsAppNumber } from '../src/domain/whatsappOrder.js';
```

No tipo `PublicCartResponse` (bloco `business: { ... }`, hoje com `name`, `address`, `pixEnabled`, `deliveryEnabled`, `deliveryNeighborhoods`, `logoUrl?`, `welcomeText?`, `featuredEnabled?`, `featuredProductIds?`, `businessHours?`), adicionar:

```ts
    whatsapp: string | null;
```

- [ ] **Step 4: Preencher `whatsapp` nos dois construtores de business**

Em `server/zelomenuCartSessions.ts`, nos DOIS locais que montam `business: { name: config.name, ... }` (dentro de `buildPublicResponse` e de `getPublicStoreBySlug`), adicionar a linha:

```ts
      whatsapp: toWhatsAppNumber(config.contato),
```

- [ ] **Step 5: Verificar transpile do servidor (server fica fora do tsc)**

Run:
```bash
npx tsx -e "import('./server/zelomenuCartSessions.ts').then(()=>console.log('OK')).catch(e=>{console.error(String(e).slice(0,300));process.exit(1)})"
for f in $(find server -name "*.ts"); do npx esbuild "$f" --bundle=false --outfile=/dev/null >/dev/null 2>&1 || echo "FAIL: $f"; done; echo "esbuild sweep done"
```
Expected: imprime `OK` e `esbuild sweep done` sem nenhuma linha `FAIL:`.

- [ ] **Step 6: Commit**

```bash
git add server/configStore.ts server/zelomenuCartSessions.ts
git commit -m "feat(whatsapp): expõe business.whatsapp (empresa_perfil.contato) na resposta pública"
```

---

### Task 4: Frontend — tipo + botão na comprovação

**Files:**
- Modify: `src/services/zelomenuApi.ts` (campo `whatsapp` no business)
- Modify: `src/pages/ZeloMenuCartPage.tsx` (import + botão no bloco `isConfirmed`)

**Interfaces:**
- Consumes: `buildWhatsAppOrderMessage`, `buildWhatsAppOrderLink` de `../domain/whatsappOrder`; `payload.business.whatsapp`.
- Produces: UI (sem exports novos).

- [ ] **Step 1: Adicionar `whatsapp` ao tipo business do cliente**

In `src/services/zelomenuApi.ts`, no objeto `business` de `ZeloMenuPublicCartResponse` (após `deliveryNeighborhoods`), adicionar:

```ts
    whatsapp?: string | null;
```

- [ ] **Step 2: Importar os helpers no cart page**

In `src/pages/ZeloMenuCartPage.tsx`, junto aos imports de domain (perto de `import { maskBrazilianPhone, normalizePhoneNumber } from '../domain/chat';`), adicionar:

```ts
import { buildWhatsAppOrderMessage, buildWhatsAppOrderLink } from '../domain/whatsappOrder';
```

Garantir que `MessageCircle` já está importado de `lucide-react` (já é usado no bloco `isConfirmed`); nenhum import de ícone novo é necessário.

- [ ] **Step 3: Substituir o bloco do botão "Voltar ao cardápio"**

In `src/pages/ZeloMenuCartPage.tsx`, no bloco `isConfirmed`, substituir o trecho atual:

```tsx
              {!isTableOrder && (() => {
                const slug = payload?.session?.metadata?.slug;
                const storeSlug = typeof slug === 'string' ? slug : null;
                return storeSlug ? (
                  <Link
                    to={buildPublicStorePath(storeSlug)}
                    className="mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-6 text-[14px] font-semibold text-[var(--color-brand)] transition-colors hover:bg-[var(--color-brand-soft)] active:scale-90"
                  >
                    Voltar ao cardápio
                  </Link>
                ) : null;
              })()}
```

por:

```tsx
              {!isTableOrder && (() => {
                const slug = payload?.session?.metadata?.slug;
                const storeSlug = typeof slug === 'string' ? slug : null;
                const whatsapp = payload?.business.whatsapp ?? null;
                const whatsappHref = isPublicOrder && whatsapp
                  ? buildWhatsAppOrderLink(
                      whatsapp,
                      buildWhatsAppOrderMessage({
                        orderId: payload?.session.orderingId ?? '',
                        customerName: draft.customerName || null,
                        items: estimated.items.map((item) => ({
                          name: item.productName,
                          quantity: item.quantity,
                          lineTotal: item.lineTotal,
                        })),
                        subtotal: estimated.subtotal,
                        total: estimated.total,
                        feeToConfirm,
                        isDelivery,
                        whenLabel,
                        deliveryAddress: isDelivery ? (draft.deliveryAddress || null) : null,
                        deliveryNeighborhood: isDelivery ? (draft.deliveryNeighborhood || null) : null,
                        observations: draft.observations || null,
                      }),
                    )
                  : null;
                if (!whatsappHref && !storeSlug) return null;
                return (
                  <div className="mt-6 flex w-full max-w-[300px] flex-col gap-2.5">
                    {whatsappHref && (
                      <a
                        href={whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-6 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 active:scale-95"
                      >
                        <MessageCircle className="h-4 w-4" strokeWidth={2} />
                        Enviar pedido no WhatsApp
                      </a>
                    )}
                    {storeSlug && (
                      <Link
                        to={buildPublicStorePath(storeSlug)}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-6 text-[14px] font-semibold text-[var(--color-brand)] transition-colors hover:bg-[var(--color-brand-soft)] active:scale-90"
                      >
                        Voltar ao cardápio
                      </Link>
                    )}
                  </div>
                );
              })()}
```

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: PASS (tsc sem erros). Se `estimated` acusar possível `null`, use o mesmo acesso já presente no arquivo (ex.: linha que faz `estimated.items.reduce(...)` sem guarda) — o bloco `isConfirmed` só renderiza com `payload`/`draft`/`estimated` presentes.

- [ ] **Step 5: Rodar a suíte de testes**

Run: `npx vitest run src/`
Expected: PASS em todos (incluindo `whatsappOrder.test.ts`).

- [ ] **Step 6: Verificação manual (build + navegador)**

Run: `npm run build`
Expected: build sem erros.

Verificação de comportamento (usar a skill `verify` ou manual): abrir um pedido público confirmado numa loja com `contato` preenchido e conferir que o botão "Enviar pedido no WhatsApp" aparece e abre o `wa.me` com o resumo; numa loja sem `contato`, o botão não aparece e "Voltar ao cardápio" continua.

- [ ] **Step 7: Commit**

```bash
git add src/services/zelomenuApi.ts src/pages/ZeloMenuCartPage.tsx
git commit -m "feat(whatsapp): botão Enviar pedido no WhatsApp na comprovação (pedido público)"
```

---

## Notas de execução

- Ao commitar, adicionar SOMENTE os arquivos de cada task (`git add <paths>`), nunca `git add -A`: há um agente de auto-commit (Verboo) ativo no repo e mudanças soltas na árvore de trabalho (`.gitignore`, `package*.json`, etc.) que não fazem parte desta feature.
- Não fazer push; o deploy é manual (Dokploy no push para `master`).
- Cada helper de mensagem/link e `toWhatsAppNumber` é puro e coberto por teste; a UI é verificada por type-check + build + checagem manual no navegador (não automatizar login).
