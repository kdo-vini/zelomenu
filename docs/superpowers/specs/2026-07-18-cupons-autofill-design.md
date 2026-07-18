# Cupons de desconto (MVP) + Autofill de cliente na mesma loja

Data: 2026-07-18

Este documento é o contrato de implementação. As decisões de escopo já foram
aprovadas; o que resta é código. Onde o brainstorming original deixava uma
lacuna, este documento fecha a lacuna e marca a decisão em **Ambiguidades
resolvidas**, no final.

## Objetivo

Adicionar cupons de desconto no checkout público do ZeloMenu (quick win
table-stakes) e um autofill que reconhece o cliente que já pediu naquele
aparelho (nome/telefone/endereço), sem risco de privacidade.

## Escopo do MVP (IN)

- Tipos de cupom: valor fixo (R$), percentual (%), frete grátis.
- Desconto no PEDIDO INTEIRO (não por produto/categoria).
- Vale só no ZeloMenu público (`context === 'public_order'`, caminho canônico
  `zelo_orders`). NÃO em mesa/QR (`table_order`) nem PDV/`whatsapp_order`.
- Limites: validade (`starts_at`/`expires_at`), pedido mínimo
  (`min_order_value`), "um por cliente" (por telefone).
- Autofill device-local: guarda nome/telefone/endereço do cliente no
  localStorage do aparelho dele e preenche na volta.

## Fora de escopo (OUT / YAGNI)

- Cupom por produto/categoria.
- Limite total de usos global (`max_redemptions`).
- Cupom em mesa/QR e PDV.
- Busca de cliente por telefone no servidor ("Camada 2 / conta Zelo" — exige
  verificação OTP + decisão LGPD; épico separado).
- Endereços salvos múltiplos por cliente.

---

## 1. Modelo de dados

Duas tabelas novas, seguindo **exatamente** o padrão de RLS já usado por
`zelomenu_modifier_groups` (`zelopdv/.ai/migrations/zelomenu_publication_schema_2026_06_23.sql`,
linhas 103–191): `id_usuario uuid not null references auth.users(id)`, RLS
ligado, 4 políticas `authenticated` gated por
`get_owner_user_id(auth.uid()) = id_usuario`, revoke geral e grant explícito
para `authenticated, service_role`.

### Ponto de atenção — `id_usuario` vs `empresa_id`

As rotas Express de admin (`requireEmpresaId(req)`, em
`server/supabaseServer.ts:64-70`) resolvem **`empresaId`**
(`empresa_perfil.id`), não `id_usuario` (`auth.users.id`). As tabelas
`zelomenu_product_publications`/`zelomenu_modifier_groups` chaveiam por
`id_usuario`, enquanto `zelo_orders`/`empresa_perfil` chaveiam por
`empresa_id`. Toda leitura/escrita em `zelomenu_coupons` e
`zelomenu_coupon_redemptions` a partir do servidor **deve primeiro converter**
`empresaId → ownerUserId` com `getEmpresaUserId(empresaId)`
(`server/supabaseServer.ts:72-83`, já usado em `server/index.ts:292` e `:312`
para o mesmo propósito nas rotas de mesas). Isso vale tanto para as rotas
admin quanto para a validação de cupom dentro de `resolveSnapshots`.

### Novo arquivo de migração

`supabase/migrations/20260718140000_zelomenu_coupons.sql`

```sql
-- ZeloMenu — cupons de desconto (MVP) e registro de resgate por cliente.
-- Segue o padrão de zelomenu_modifier_groups (id_usuario, RLS 4-policy).

create table if not exists public.zelomenu_coupons (
  id uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references auth.users(id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('valor', 'percentual', 'frete_gratis')),
  discount_value numeric(10,2),
  min_order_value numeric(10,2),
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint zelomenu_coupons_user_code_unique unique (id_usuario, lower(code)),
  constraint zelomenu_coupons_code_format check (code ~ '^[A-Z0-9-]{3,30}$'),
  constraint zelomenu_coupons_min_order_non_negative check (min_order_value is null or min_order_value >= 0),
  constraint zelomenu_coupons_valor_requires_value
    check (discount_type <> 'valor' or (discount_value is not null and discount_value > 0)),
  constraint zelomenu_coupons_percentual_requires_value
    check (discount_type <> 'percentual' or (discount_value is not null and discount_value > 0 and discount_value <= 100)),
  constraint zelomenu_coupons_frete_gratis_no_value
    check (discount_type <> 'frete_gratis' or discount_value is null),
  constraint zelomenu_coupons_window_order
    check (starts_at is null or expires_at is null or starts_at <= expires_at)
);

comment on table public.zelomenu_coupons is
  'Cupons de desconto do ZeloMenu público (pedido inteiro). Não vale para mesa/QR nem PDV.';
comment on column public.zelomenu_coupons.discount_value is
  'R$ para discount_type=valor, % (0-100] para percentual, null/ignorado para frete_gratis.';

create index if not exists zelomenu_coupons_user_active_idx
  on public.zelomenu_coupons (id_usuario, active);

alter table public.zelomenu_coupons enable row level security;

drop policy if exists zelomenu_coupons_actor_select on public.zelomenu_coupons;
create policy zelomenu_coupons_actor_select
  on public.zelomenu_coupons
  for select
  to authenticated
  using (get_owner_user_id(auth.uid()) = id_usuario);

drop policy if exists zelomenu_coupons_actor_insert on public.zelomenu_coupons;
create policy zelomenu_coupons_actor_insert
  on public.zelomenu_coupons
  for insert
  to authenticated
  with check (get_owner_user_id(auth.uid()) = id_usuario);

drop policy if exists zelomenu_coupons_actor_update on public.zelomenu_coupons;
create policy zelomenu_coupons_actor_update
  on public.zelomenu_coupons
  for update
  to authenticated
  using (get_owner_user_id(auth.uid()) = id_usuario)
  with check (get_owner_user_id(auth.uid()) = id_usuario);

drop policy if exists zelomenu_coupons_actor_delete on public.zelomenu_coupons;
create policy zelomenu_coupons_actor_delete
  on public.zelomenu_coupons
  for delete
  to authenticated
  using (get_owner_user_id(auth.uid()) = id_usuario);

revoke all on public.zelomenu_coupons from anon, authenticated, service_role;
grant select, insert, update, delete
  on public.zelomenu_coupons
  to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.zelomenu_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.zelomenu_coupons(id) on delete cascade,
  id_usuario uuid not null references auth.users(id) on delete cascade,
  customer_phone text not null check (customer_phone ~ '^[0-9]{8,15}$'),
  order_id uuid references public.zelo_orders(id) on delete set null,
  redeemed_at timestamptz not null default now(),

  constraint zelomenu_coupon_redemptions_one_per_customer unique (coupon_id, customer_phone)
);

comment on table public.zelomenu_coupon_redemptions is
  'Registra o resgate de um cupom por telefone do cliente. A constraint unique(coupon_id, customer_phone) é o que impõe "um por cliente".';

create index if not exists zelomenu_coupon_redemptions_user_idx
  on public.zelomenu_coupon_redemptions (id_usuario);
create index if not exists zelomenu_coupon_redemptions_order_idx
  on public.zelomenu_coupon_redemptions (order_id) where order_id is not null;

alter table public.zelomenu_coupon_redemptions enable row level security;

drop policy if exists zelomenu_coupon_redemptions_actor_select on public.zelomenu_coupon_redemptions;
create policy zelomenu_coupon_redemptions_actor_select
  on public.zelomenu_coupon_redemptions
  for select
  to authenticated
  using (get_owner_user_id(auth.uid()) = id_usuario);

drop policy if exists zelomenu_coupon_redemptions_actor_insert on public.zelomenu_coupon_redemptions;
create policy zelomenu_coupon_redemptions_actor_insert
  on public.zelomenu_coupon_redemptions
  for insert
  to authenticated
  with check (get_owner_user_id(auth.uid()) = id_usuario);

drop policy if exists zelomenu_coupon_redemptions_actor_update on public.zelomenu_coupon_redemptions;
create policy zelomenu_coupon_redemptions_actor_update
  on public.zelomenu_coupon_redemptions
  for update
  to authenticated
  using (get_owner_user_id(auth.uid()) = id_usuario)
  with check (get_owner_user_id(auth.uid()) = id_usuario);

drop policy if exists zelomenu_coupon_redemptions_actor_delete on public.zelomenu_coupon_redemptions;
create policy zelomenu_coupon_redemptions_actor_delete
  on public.zelomenu_coupon_redemptions
  for delete
  to authenticated
  using (get_owner_user_id(auth.uid()) = id_usuario);

revoke all on public.zelomenu_coupon_redemptions from anon, authenticated, service_role;
grant select, insert, update, delete
  on public.zelomenu_coupon_redemptions
  to authenticated, service_role;
```

Notas sobre as constraints:
- `code_format` força maiúsculas/dígitos/hífen (3–30 chars). A aplicação
  normaliza (`trim().toUpperCase()`) antes de gravar e antes de consultar —
  ver `normalizeCouponCode` na seção 2. Isso evita ter que usar `ilike`/`like`
  nas buscas (um código com `_` faria o Postgres tratar `_` como wildcard de
  `LIKE`; como o charset permitido não tem `_`, o problema nem existe, mas a
  aplicação faz sempre `eq('code', normalizado)`, nunca `ilike`).
- `customer_phone` é sempre dígitos (DDD+número, sem `+55`), mesmo formato
  produzido por `normalizePhoneNumber` (`src/domain/chat.ts:1`).
- Nenhuma alteração em `zelo_orders`: a coluna `discount` e o `check
  (total = subtotal + delivery_fee - discount)` já existem
  (`zelopdv/.ai/migrations/canonical_online_orders_2026_07_12.sql:23,34`), e o
  RPC `create_zelo_order` já lê `pricing.discount` do `p_snapshots`
  (mesmo arquivo, linha 146: `v_discount:=coalesce((p_snapshots#>>'{pricing,discount}')::numeric,0);`).
  Confirmado também que `src/domain/zeloCanonicalOrder.ts:24`
  (`buildCanonicalOrderSnapshots`) repassa `pricing: input.pricing` inteiro
  sem filtrar campos — então basta o snapshot do carrinho carregar `discount`
  para ele fluir até `zelo_orders.discount` sem tocar em mais nada.
- Como o banco é compartilhado entre ZeloPDV/ZeloChat/ZeloMenu, esta migração
  só precisa ser aplicada uma vez (o mesmo padrão já seguido por
  `20260712120000_zelomenu_transactional_checkout.sql`, que existe idêntico
  nos dois repositórios). Se o time mantém cópia em
  `zelopdv/.ai/migrations/`, replicar o mesmo SQL lá também — mas isso é
  processo de equipe, não bloqueia o trabalho deste repositório.

---

## 2. Pricing — fonte única cliente↔servidor

### 2.1 `src/domain/zelomenuCoupon.ts` (novo arquivo)

Espelha `src/domain/zelomenuDelivery.ts` (mesmo arquivo importado idêntico no
front e no back). Segue a mesma convenção de duplicar um `roundCurrency`
local em vez de importar entre módulos de domínio (é o que
`server/zelomenuCartSessions.ts:67-69` já faz — tem seu próprio
`roundCurrency` local mesmo importando `resolveDeliveryFeeForNeighborhood` de
`zelomenuDelivery.ts`).

```ts
// ZeloMenu — cupons de desconto (FONTE ÚNICA, node-free).
// Mesma lógica no client (estimativa) e no server (validação real): frontend
// e backend importam a mesma função pra o desconto exibido nunca divergir do
// revalidado pelo servidor.

export type ZeloMenuCouponDiscountType = 'valor' | 'percentual' | 'frete_gratis';

export type ZeloMenuCouponRule = {
  code: string;
  discountType: ZeloMenuCouponDiscountType;
  discountValue: number | null;
  minOrderValue: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

export type ZeloMenuCouponValidationIssueCode =
  | 'coupon_invalid'
  | 'coupon_expired'
  | 'coupon_min_not_met';

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// Normaliza um código digitado pelo usuário para o formato canônico
// (A-Z0-9-, 3-30 chars). Retorna null se não bater com o formato — chamador
// decide se isso vira "cupom inválido" ou apenas ignora silenciosamente.
export function normalizeCouponCode(raw: string): string | null {
  const normalized = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{3,30}$/.test(normalized) ? normalized : null;
}

// Valida janela de validade, flag `active` e pedido mínimo. NÃO valida
// "um por cliente" (isso depende de telefone + banco; fica no servidor,
// em server/zelomenuCoupons.ts, na hora de confirmar).
export function validateCouponRule(
  coupon: ZeloMenuCouponRule | null,
  input: { subtotal: number; now?: Date },
): { ok: true } | { ok: false; code: ZeloMenuCouponValidationIssueCode } {
  if (!coupon || !coupon.active) return { ok: false, code: 'coupon_invalid' };
  const now = input.now ?? new Date();
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return { ok: false, code: 'coupon_expired' };
  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) return { ok: false, code: 'coupon_expired' };
  if (coupon.minOrderValue != null && input.subtotal < coupon.minOrderValue) {
    return { ok: false, code: 'coupon_min_not_met' };
  }
  return { ok: true };
}

// Calcula o desconto para um pedido inteiro. Clamp: nunca negativo, nunca
// maior que subtotal + entrega (total nunca fica negativo).
export function applyCoupon(
  subtotal: number,
  deliveryFee: number,
  coupon: Pick<ZeloMenuCouponRule, 'discountType' | 'discountValue'> | null,
): { discount: number } {
  if (!coupon) return { discount: 0 };
  let discount = 0;
  if (coupon.discountType === 'valor') {
    discount = Math.min(Number(coupon.discountValue) || 0, subtotal);
  } else if (coupon.discountType === 'percentual') {
    discount = roundCurrency((subtotal * (Number(coupon.discountValue) || 0)) / 100);
  } else if (coupon.discountType === 'frete_gratis') {
    discount = deliveryFee;
  }
  const cap = roundCurrency(subtotal) + roundCurrency(deliveryFee);
  return { discount: roundCurrency(Math.max(0, Math.min(discount, cap))) };
}
```

Regras (já embutidas no código acima):
- `valor`: `discount = min(discount_value, subtotal)`.
- `percentual`: `discount = round(subtotal * pct/100)`.
- `frete_gratis`: `discount = deliveryFee` (que já é 0 em retirada — ver seção
  6 sobre a mensagem quando não há entrega).
- Clamp final: `discount` nunca maior que `subtotal + deliveryFee`; `total =
  max(0, subtotal + deliveryFee - discount)` fica garantido por construção.

### 2.2 `src/domain/zelomenuCartSchema.ts` — estender `ZeloMenuPricingSnapshot`

Hoje (linhas 22–26):

```ts
export type ZeloMenuPricingSnapshot = {
  subtotal: number;
  deliveryFee: number;
  total: number;
};
```

Passa a ser:

```ts
export type ZeloMenuPricingSnapshot = {
  subtotal: number;
  deliveryFee: number;
  discount: number;
  couponCode: string | null;
  // Detalhes da regra do cupom aplicado, ecoados pelo servidor para o
  // cliente poder recalcular a MESMA estimativa localmente (via applyCoupon)
  // entre um autosave e outro, sem esperar round-trip. Ambos null quando
  // couponCode é null.
  couponDiscountType: 'valor' | 'percentual' | 'frete_gratis' | null;
  couponDiscountValue: number | null;
  total: number;
};
```

E o union de issues (linhas 34–48) ganha 4 códigos novos:

```ts
export type ZeloMenuCartRevalidationIssue = {
  code:
    | 'product_missing'
    | 'product_unavailable'
    | 'stock_insufficient'
    | 'price_changed'
    | 'schedule_unavailable'
    | 'modifier_invalid'
    | 'coupon_invalid'
    | 'coupon_expired'
    | 'coupon_min_not_met'
    | 'coupon_already_used';
  message: string;
  productName?: string;
  requestedQuantity?: number;
  availableQuantity?: number | null;
  previousUnitPrice?: number;
  currentUnitPrice?: number;
};
```

### 2.3 `src/services/zelomenuApi.ts` — tipo duplicado precisa do mesmo ajuste

`ZeloMenuCartSessionPayload.pricing` (linhas 77–81) **não** importa
`ZeloMenuPricingSnapshot` do domínio — define os mesmos campos inline. Aplicar
a mesma extensão aqui:

```ts
  pricing: {
    subtotal: number;
    deliveryFee: number;
    discount: number;
    couponCode: string | null;
    couponDiscountType: 'valor' | 'percentual' | 'frete_gratis' | null;
    couponDiscountValue: number | null;
    total: number;
  };
```

E `ZeloMenuUpdateCartPayload` (linhas 125–146) ganha o campo de entrada do
cupom, ao lado de `paymentMethod` (linha 144):

```ts
  paymentMethod?: string | null;
  couponCode?: string | null; // undefined = não mexe; null/'' = remove cupom; string = tenta aplicar/revalidar
  observations?: string | null;
```

### 2.4 Servidor — `server/zelomenuCartSessions.ts`

**`computeCartPricing`** (linhas 71–82) ganha dois parâmetros e devolve os
campos novos:

```ts
function computeCartPricing(
  items: Array<{ lineTotal: number }>,
  deliveryFee = 0,
  discount = 0,
  coupon: { code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null } | null = null,
): ZeloMenuPricingSnapshot {
  const fee = Number.isFinite(deliveryFee) ? Number(deliveryFee) : 0;
  const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
  const cap = roundCurrency(subtotal) + roundCurrency(fee);
  const clampedDiscount = Math.max(0, Math.min(Number(discount) || 0, cap));
  return {
    subtotal: roundCurrency(subtotal),
    deliveryFee: roundCurrency(fee),
    discount: roundCurrency(clampedDiscount),
    couponCode: coupon?.code ?? null,
    couponDiscountType: coupon?.discountType ?? null,
    couponDiscountValue: coupon?.discountValue ?? null,
    total: roundCurrency(subtotal + fee - clampedDiscount),
  };
}
```

**`resolveSnapshots`** (assinatura hoje em linhas 560–568) ganha `context` e
`couponCode`:

```ts
async function resolveSnapshots(
  empresaId: string,
  params: {
    items: ZeloMenuCartItemInput[];
    fulfillment?: Partial<ZeloMenuFulfillmentSnapshot> | null;
    paymentMethod?: string | null;
    observations?: string | null;
    context: ZeloMenuCartContext;
    couponCode?: string | null;
  },
): Promise<ResolvedCart>
```

Dentro da função, logo depois de resolver `deliveryFee`/`deliveryFeeToConfirm`
(linhas 606–617) e antes de `computeCartPricing` (linha 629), inserir a
validação do cupom:

```ts
  let discount = 0;
  let appliedCoupon: { code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null } | null = null;
  if (params.context === 'public_order' && params.couponCode) {
    const normalizedCode = normalizeCouponCode(params.couponCode);
    const ownerUserId = normalizedCode ? await getEmpresaUserId(empresaId) : null;
    const coupon = normalizedCode && ownerUserId
      ? await findActiveCouponByCode(ownerUserId, normalizedCode)
      : null;
    const subtotalSoFar = roundCurrency(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0));
    const validation = validateCouponRule(coupon, { subtotal: subtotalSoFar });
    if (!validation.ok) {
      throw new Error(
        validation.code === 'coupon_min_not_met' ? 'COUPON_MIN_NOT_MET'
        : validation.code === 'coupon_expired' ? 'COUPON_EXPIRED'
        : 'COUPON_INVALID',
      );
    }
    const applied = applyCoupon(subtotalSoFar, deliveryFee, coupon!);
    discount = applied.discount;
    appliedCoupon = { code: coupon!.code, discountType: coupon!.discountType, discountValue: coupon!.discountValue };
  }
  const pricing = computeCartPricing(resolvedItems, deliveryFee, discount, appliedCoupon);
```

(substitui a linha atual `const pricing = computeCartPricing(resolvedItems, deliveryFee);`).

Novos imports no topo do arquivo (perto da linha 21, junto de
`resolveDeliveryFeeForNeighborhood`):

```ts
import { normalizeCouponCode, validateCouponRule, applyCoupon } from '../src/domain/zelomenuCoupon.js';
import { findActiveCouponByCode } from './zelomenuCoupons.js';
import { normalizePhoneNumber } from '../src/domain/chat.js';
```

**`cartIssueFromError`** (linhas 695–702) ganha 3 dos 4 códigos novos (o 4º,
`coupon_already_used`, é construído manualmente em `confirmPublicCartSession`
— ver seção 3, ele não nasce de um erro de `resolveSnapshots`):

```ts
function cartIssueFromError(message: string): ZeloMenuCartRevalidationIssue | null {
  if (message === 'PRODUCT_NOT_FOUND') return { code: 'product_missing', message: 'Um item desse carrinho não existe mais no cardápio.' };
  if (message === 'PRODUCT_UNAVAILABLE') return { code: 'product_unavailable', message: 'Um item desse carrinho não está disponível no momento.' };
  if (message === 'PRODUCT_STOCK_EXCEEDED') return { code: 'stock_insufficient', message: 'A quantidade de um item ultrapassa o estoque atual.' };
  if (message === 'DELIVERY_DISABLED') return { code: 'schedule_unavailable', message: 'A entrega precisa ser revista antes da confirmação.' };
  if (message.startsWith('MODIFIER_INVALID:')) return { code: 'modifier_invalid', message: message.slice('MODIFIER_INVALID:'.length) };
  if (message === 'COUPON_INVALID') return { code: 'coupon_invalid', message: 'Este cupom não é válido para esta loja.' };
  if (message === 'COUPON_EXPIRED') return { code: 'coupon_expired', message: 'Este cupom não está mais válido.' };
  if (message === 'COUPON_MIN_NOT_MET') return { code: 'coupon_min_not_met', message: 'O pedido ainda não atingiu o valor mínimo para este cupom.' };
  return null;
}
```

Todos os 3 chamadores de `resolveSnapshots` precisam do novo campo
obrigatório `context` (o `couponCode` é opcional):

- `openPublicOrderCartSession` (chamada na linha 983): passar
  `context: input.context ?? 'public_order'`. Nunca passa `couponCode` — a
  criação do carrinho acontece antes do Passo 3, onde o cupom é aplicado.
- `updatePublicCartSession` (chamada na linha 1068): passar
  `context: sessionRow.context` e
  `couponCode: patch.couponCode === undefined ? current.pricing.couponCode : patch.couponCode`
  (mesmo padrão de "undefined mantém, valor explícito substitui" já usado
  para `customerName`/`customerPhone` nas linhas 1064–1067).
- `runRevalidation` (chamada na linha 712): passar
  `context: session.context` (já existe no objeto `PublicCartSession`) e
  `couponCode: session.pricing.couponCode`.

**`parsePricingSnapshot`** (linhas 377–385) precisa ler os campos novos de
volta do JSON armazenado:

```ts
function parsePricingSnapshot(value: unknown): ZeloMenuPricingSnapshot {
  if (!value || typeof value !== 'object') {
    return { subtotal: 0, deliveryFee: 0, discount: 0, couponCode: null, couponDiscountType: null, couponDiscountValue: null, total: 0 };
  }
  const row = value as {
    subtotal?: unknown; deliveryFee?: unknown; discount?: unknown;
    couponCode?: unknown; couponDiscountType?: unknown; couponDiscountValue?: unknown; total?: unknown;
  };
  return {
    subtotal: Number.isFinite(Number(row.subtotal)) ? Number(row.subtotal) : 0,
    deliveryFee: Number.isFinite(Number(row.deliveryFee)) ? Number(row.deliveryFee) : 0,
    discount: Number.isFinite(Number(row.discount)) ? Number(row.discount) : 0,
    couponCode: typeof row.couponCode === 'string' ? row.couponCode : null,
    couponDiscountType: row.couponDiscountType === 'valor' || row.couponDiscountType === 'percentual' || row.couponDiscountType === 'frete_gratis'
      ? row.couponDiscountType
      : null,
    couponDiscountValue: Number.isFinite(Number(row.couponDiscountValue)) ? Number(row.couponDiscountValue) : null,
    total: Number.isFinite(Number(row.total)) ? Number(row.total) : 0,
  };
}
```

### 2.5 Cliente — `src/pages/ZeloMenuCartPage.tsx`

`estimateDraftTotals` (linhas 158–201) recebe o cupom aplicado (lido do
último `payload.session.pricing` bem-sucedido) e usa `applyCoupon` para
estimar o desconto localmente entre um autosave e outro:

```ts
function estimateDraftTotals(
  draft: DraftState,
  catalog: ZeloMenuCatalogGroup[],
  neighborhoods: Array<{ name: string; fee: number }>,
  appliedCoupon: { discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null } | null,
) {
  // ... corpo inalterado até calcular `subtotal` e `deliveryFee` (linhas 188-193) ...
  const { discount } = applyCoupon(subtotal, deliveryFee, appliedCoupon);
  return {
    items,
    subtotal,
    deliveryFee,
    deliveryFeeToConfirm,
    discount,
    total: Math.max(0, subtotal + deliveryFee - discount),
  };
}
```

Novo import no topo do arquivo (perto da linha 41, junto de
`resolveDeliveryFeeForNeighborhood`):

```ts
import { applyCoupon } from '../domain/zelomenuCoupon';
```

No local onde `estimateDraftTotals` é chamado (a variável `estimated`, usada
no bloco Resumo — ver seção 5), passar
`payload?.session.pricing.couponCode ? { discountType: payload.session.pricing.couponDiscountType!, discountValue: payload.session.pricing.couponDiscountValue } : null`
como quarto argumento.

---

## 3. Fluxo de confirm / resgate (Abordagem A — validação no Node, sem tocar no RPC compartilhado)

### 3.1 Novo arquivo `server/zelomenuCoupons.ts`

Centraliza toda leitura/escrita das duas tabelas novas. Não depende de nada
de `zelomenuCartSessions.ts` (evita import circular), só de
`getServiceSupabase` (`server/supabaseServer.ts`).

```ts
import { getServiceSupabase } from './supabaseServer.js';
import type { ZeloMenuCouponRule } from '../src/domain/zelomenuCoupon.js';

export type ZeloMenuCouponRow = ZeloMenuCouponRule & { id: string };

function mapCouponRow(row: any): ZeloMenuCouponRow {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value === null ? null : Number(row.discount_value),
    minOrderValue: row.min_order_value === null ? null : Number(row.min_order_value),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    active: row.active === true,
  };
}

// Usada pelo pricing (resolveSnapshots) — busca por código exato já
// normalizado (uppercase A-Z0-9-), nunca por LIKE/ILIKE.
export async function findActiveCouponByCode(ownerUserId: string, normalizedCode: string): Promise<ZeloMenuCouponRow | null> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active')
    .eq('id_usuario', ownerUserId)
    .eq('code', normalizedCode)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCouponRow(data) : null;
}

// Reserva o resgate (insert com unique(coupon_id, customer_phone)).
export async function reserveCouponRedemption(params: {
  couponId: string;
  ownerUserId: string;
  customerPhone: string;
}): Promise<{ ok: true; redemptionId: string } | { ok: false }> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupon_redemptions')
    .insert({ coupon_id: params.couponId, id_usuario: params.ownerUserId, customer_phone: params.customerPhone })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false }; // unique_violation — já usado por este telefone
    throw error;
  }
  return { ok: true, redemptionId: (data as { id: string }).id };
}

export async function attachOrderToRedemption(redemptionId: string, orderId: string): Promise<void> {
  const { error } = await getServiceSupabase()
    .from('zelomenu_coupon_redemptions')
    .update({ order_id: orderId })
    .eq('id', redemptionId);
  if (error) throw error;
}

// Rollback manual — usado quando a reserva foi feita mas a criação do
// pedido falhou depois. Ver tradeoff documentado abaixo.
export async function releaseCouponRedemption(redemptionId: string): Promise<void> {
  await getServiceSupabase().from('zelomenu_coupon_redemptions').delete().eq('id', redemptionId);
}

// ─── Admin CRUD (empresaId já convertido para ownerUserId pelo chamador) ──

export async function listZeloMenuCoupons(ownerUserId: string): Promise<ZeloMenuCouponRow[]> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active, created_at')
    .eq('id_usuario', ownerUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapCouponRow);
}

export async function createZeloMenuCoupon(ownerUserId: string, input: {
  code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null;
  minOrderValue: number | null; startsAt: string | null; expiresAt: string | null; active: boolean;
}): Promise<ZeloMenuCouponRow> {
  const { normalizeCouponCode } = await import('../src/domain/zelomenuCoupon.js');
  const normalized = normalizeCouponCode(input.code);
  if (!normalized) throw new Error('COUPON_INVALID_CODE');
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .insert({
      id_usuario: ownerUserId,
      code: normalized,
      discount_type: input.discountType,
      discount_value: input.discountType === 'frete_gratis' ? null : input.discountValue,
      min_order_value: input.minOrderValue,
      starts_at: input.startsAt,
      expires_at: input.expiresAt,
      active: input.active,
    })
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active, created_at')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('COUPON_CODE_TAKEN');
    if (error.code === '23514') throw new Error('COUPON_INVALID_DISCOUNT_VALUE');
    throw error;
  }
  return mapCouponRow(data);
}

export async function updateZeloMenuCoupon(ownerUserId: string, id: string, patch: Partial<{
  code: string; discountType: 'valor' | 'percentual' | 'frete_gratis'; discountValue: number | null;
  minOrderValue: number | null; startsAt: string | null; expiresAt: string | null; active: boolean;
}>): Promise<ZeloMenuCouponRow> {
  const { normalizeCouponCode } = await import('../src/domain/zelomenuCoupon.js');
  const update: Record<string, unknown> = {};
  if (patch.code !== undefined) {
    const normalized = normalizeCouponCode(patch.code);
    if (!normalized) throw new Error('COUPON_INVALID_CODE');
    update.code = normalized;
  }
  if (patch.discountType !== undefined) update.discount_type = patch.discountType;
  if (patch.discountValue !== undefined) update.discount_value = patch.discountValue;
  // Se o tipo está virando frete_gratis, força discount_value=null mesmo que
  // o chamador não tenha mandado — evita violar zelomenu_coupons_frete_gratis_no_value
  // quando o admin troca o tipo sem limpar o campo de valor no mesmo PATCH.
  if (patch.discountType === 'frete_gratis') update.discount_value = null;
  if (patch.minOrderValue !== undefined) update.min_order_value = patch.minOrderValue;
  if (patch.startsAt !== undefined) update.starts_at = patch.startsAt;
  if (patch.expiresAt !== undefined) update.expires_at = patch.expiresAt;
  if (patch.active !== undefined) update.active = patch.active;
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .update(update)
    .eq('id', id)
    .eq('id_usuario', ownerUserId)
    .select('id, code, discount_type, discount_value, min_order_value, starts_at, expires_at, active, created_at')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') throw new Error('COUPON_CODE_TAKEN');
    if (error.code === '23514') throw new Error('COUPON_INVALID_DISCOUNT_VALUE');
    throw error;
  }
  if (!data) throw new Error('COUPON_NOT_FOUND');
  return mapCouponRow(data);
}

// "Excluir" no admin é soft-delete (active=false). Nunca remove a linha —
// preserva o histórico de zelomenu_coupon_redemptions e evita reusar um
// código apagado por engano.
export async function deleteZeloMenuCoupon(ownerUserId: string, id: string): Promise<void> {
  const { data, error } = await getServiceSupabase()
    .from('zelomenu_coupons')
    .update({ active: false })
    .eq('id', id)
    .eq('id_usuario', ownerUserId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('COUPON_NOT_FOUND');
}
```

(O `import()` dinâmico de `normalizeCouponCode` dentro das funções acima é só
para manter o exemplo compacto — na implementação real, importar
`normalizeCouponCode` uma vez no topo do arquivo, ao lado de
`ZeloMenuCouponRule`.)

### 3.2 `confirmPublicCartSession` (linhas 1100–1225)

O ponto de inserção é **entre** a revalidação (linha 1185, `const
revalidation = await runRevalidation(...)`) e a chamada do RPC (linha 1194,
`const confirmationRpc = ...`). Hoje, se `!revalidation.ok`, a função já
retorna cedo (linhas 1187–1191) sem criar o pedido — isso cobre
automaticamente `coupon_invalid`/`coupon_expired`/`coupon_min_not_met` que
tenham surgido nessa revalidação (porque `runRevalidation` chama
`resolveSnapshots` por baixo, que agora valida o cupom).

O que falta é o passo específico do resgate ("um por cliente"), que só pode
ser checado no momento do confirm (não faz sentido reservar durante
autosave). Inserir logo após a linha 1191 (dentro do `if
(current.context === 'public_order' && revalidation.previewPricing?.couponCode)`):

```ts
  let redemption: { id: string } | null = null;
  if (current.context === 'public_order' && revalidation.previewPricing?.couponCode) {
    const ownerUserId = await getEmpresaUserId(sessionRow.empresa_id);
    const coupon = ownerUserId
      ? await findActiveCouponByCode(ownerUserId, revalidation.previewPricing.couponCode)
      : null;
    const validation = validateCouponRule(coupon, { subtotal: revalidation.previewPricing.subtotal });
    if (!ownerUserId || !coupon || !validation.ok) {
      const issue: ZeloMenuCartRevalidationIssue = { code: 'coupon_invalid', message: 'Este cupom não está mais disponível.' };
      const failed: ZeloMenuCartRevalidation = { ...revalidation, ok: false, issues: [issue] };
      await persistRevalidation(current.id, failed);
      const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
      return { ...payload, confirmation: { confirmed: false, alreadyConfirmed: false, state: payload.session.state, customerMessage: null } };
    }
    const customerPhoneDigits = normalizePhoneNumber(current.customer.phone ?? '');
    const reserved = await reserveCouponRedemption({ couponId: coupon.id, ownerUserId, customerPhone: customerPhoneDigits });
    if (!reserved.ok) {
      const issue: ZeloMenuCartRevalidationIssue = { code: 'coupon_already_used', message: 'Você já usou este cupom antes.' };
      const failed: ZeloMenuCartRevalidation = { ...revalidation, ok: false, issues: [issue] };
      await persistRevalidation(current.id, failed);
      const payload = await buildPublicResponse(normalized, sessionRow, tokenRow);
      return { ...payload, confirmation: { confirmed: false, alreadyConfirmed: false, state: payload.session.state, customerMessage: null } };
    }
    redemption = { id: reserved.redemptionId };
  }
```

`current.customer.phone` está garantido não-vazio nesse ponto porque, para
`context === 'public_order'`, a validação de
`validateZeloMenuCheckoutDetails` (linhas 1119–1129, executada ANTES da
revalidação) já lança `CUSTOMER_DETAILS_REQUIRED` se o telefone estiver
faltando.

Depois, envolver a chamada do RPC (linhas 1194–1223) com rollback do
resgate:

```ts
  const { data: confirmation, error: confirmationError } = await confirmationRpc;
  if (confirmationError) {
    if (redemption) await releaseCouponRedemption(redemption.id);
    const codes = [...]; // inalterado
    throw new Error(codes.find((code) => confirmationError.message.includes(code)) || 'ORDER_MATERIALIZATION_FAILED');
  }
  const atomic = confirmation as { orderId?: string; orderStatus?: string; sessionState?: ZeloMenuCartState; state?: ZeloMenuCartState; alreadyConfirmed?: boolean };
  const atomicRow = await findSessionById(sessionRow.id);
  if (!atomicRow) {
    if (redemption) await releaseCouponRedemption(redemption.id);
    throw new Error('ORDER_MATERIALIZATION_FAILED');
  }
  if (redemption && atomic.orderId) await attachOrderToRedemption(redemption.id, atomic.orderId);
  const atomicPayload = await buildPublicResponse(normalized, atomicRow, tokenRow);
  return { ...atomicPayload, confirmation: { /* inalterado */ } };
```

O tipo `atomic` hoje (linha 1219) não lê `orderId`, mas o RPC
`create_zelo_order` **sempre** devolve `orderId` no seu `jsonb_build_object`
(`zelopdv/.ai/migrations/canonical_online_orders_2026_07_12.sql`, linha
~127-129: `jsonb_build_object('orderId',o.id,'orderStatus',o.status,...)` e o
branch de idempotência, linha ~132: `jsonb_build_object('orderId',o.id,...)`).
Adicionar `orderId?: string` ao cast é só expor o que já vem no payload.

**Tradeoff aceito do MVP:** entre `reserveCouponRedemption` e
`attachOrderToRedemption`/`releaseCouponRedemption` existe uma janela onde a
linha de resgate existe mas ainda não tem `order_id`. Se o processo cair
exatamente nesse instante (antes do `if (confirmationError)` rodar), a linha
fica "presa" sem rollback nem order_id — o cliente não conseguiria reusar
aquele cupom com aquele telefone, mesmo sem ter finalizado um pedido. Isso é
aceitável para o MVP (mesma classe de risco que qualquer outro rollback
manual sem transação distribuída) e fica documentado aqui, não escondido.

Importar em `zelomenuCartSessions.ts` (topo do arquivo):
```ts
import { findActiveCouponByCode, reserveCouponRedemption, attachOrderToRedemption, releaseCouponRedemption } from './zelomenuCoupons.js';
import { validateCouponRule } from '../src/domain/zelomenuCoupon.js';
```

---

## 4. Admin do lojista

### 4.1 `src/components/zelomenu/ZeloMenuCouponsCard.tsx` (novo componente)

Segue o formato de `ZeloMenuSettingsCard.tsx` (draft local, estados
`loading`/`saving`/`error`, sem props obrigatórias — o componente lê a sessão
Supabase sozinho via `zelomenuAdminApi.ts`). Lista cupons com criar/editar
por linha; "excluir" chama o DELETE, que é soft-delete
(`active=false`) e remove a linha da lista exibida (ver seção 3.1).

Campos do formulário (criar/editar): código (texto, auto-uppercase no
onChange para dar feedback visual do formato final), tipo (`valor` /
`percentual` / `frete_gratis` — os dois primeiros mostram um campo de valor
numérico com máscara R$ ou %; `frete_gratis` esconde o campo de valor),
pedido mínimo (opcional, R$), validade (dois campos de data, `starts_at` e
`expires_at`, ambos opcionais), ativo (toggle).

Validação client-side antes de submeter (espelha as constraints do banco,
pra não depender só do erro 400 vindo do servidor): código bate com
`normalizeCouponCode`; `valor`/`percentual` exigem valor > 0 (`percentual`
também ≤ 100); `frete_gratis` ignora o campo de valor.

**Onde montar:** renderizar `<ZeloMenuCouponsCard />` na aba de Publicação do
admin, logo abaixo de `<ZeloMenuSettingsCard />` (mesmo lugar onde o
`ZeloMenuSettingsCard` é montado hoje — `AdminPage.tsx` → `PublicationPage`).
Sem props obrigatórias, igual ao settings card.

### 4.2 Rotas em `server/index.ts`

Inserir depois da rota `PATCH /api/admin/zelomenu/settings` (que termina na
linha 212) e antes do bloco de geração de IA (linha 214), ou em qualquer
ponto do bloco de rotas admin (linhas 164–320) — a ordem entre rotas não
importa, elas não colidem em path.

```ts
// ─── Cupons (admin, Bearer-authed) ─────────────────────────────────────────

app.get('/api/admin/zelomenu/coupons', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const ownerUserId = await getEmpresaUserId(empresaId);
    if (!ownerUserId) throw new Error('EMPRESA_NOT_FOUND');
    const coupons = await listZeloMenuCoupons(ownerUserId);
    res.json({ coupons });
  } catch (error) {
    sendAdminError(res, error);
  }
});

app.post('/api/admin/zelomenu/coupons', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const ownerUserId = await getEmpresaUserId(empresaId);
    if (!ownerUserId) throw new Error('EMPRESA_NOT_FOUND');
    const coupon = await createZeloMenuCoupon(ownerUserId, {
      code: String(req.body?.code ?? ''),
      discountType: req.body?.discountType,
      discountValue: req.body?.discountValue ?? null,
      minOrderValue: req.body?.minOrderValue ?? null,
      startsAt: req.body?.startsAt ?? null,
      expiresAt: req.body?.expiresAt ?? null,
      active: req.body?.active !== false,
    });
    res.json(coupon);
  } catch (error) {
    sendAdminError(res, error);
  }
});

app.patch('/api/admin/zelomenu/coupons/:id', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const ownerUserId = await getEmpresaUserId(empresaId);
    if (!ownerUserId) throw new Error('EMPRESA_NOT_FOUND');
    const coupon = await updateZeloMenuCoupon(ownerUserId, req.params.id, req.body ?? {});
    res.json(coupon);
  } catch (error) {
    sendAdminError(res, error);
  }
});

app.delete('/api/admin/zelomenu/coupons/:id', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const ownerUserId = await getEmpresaUserId(empresaId);
    if (!ownerUserId) throw new Error('EMPRESA_NOT_FOUND');
    await deleteZeloMenuCoupon(ownerUserId, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendAdminError(res, error);
  }
});
```

Novo import no topo de `server/index.ts` (perto da linha 8/10):
```ts
import { listZeloMenuCoupons, createZeloMenuCoupon, updateZeloMenuCoupon, deleteZeloMenuCoupon } from './zelomenuCoupons.js';
```

`sendAdminError` (linhas 154–162) ganha 3 branches novos:
```ts
  if (message === 'COUPON_CODE_TAKEN') return void res.status(409).json({ error: 'COUPON_CODE_TAKEN' });
  if (message === 'COUPON_INVALID_CODE') return void res.status(400).json({ error: 'COUPON_INVALID_CODE' });
  if (message === 'COUPON_INVALID_DISCOUNT_VALUE') return void res.status(400).json({ error: 'COUPON_INVALID_DISCOUNT_VALUE' });
  if (message === 'COUPON_NOT_FOUND') return void res.status(404).json({ error: 'COUPON_NOT_FOUND' });
```

### 4.3 Wrappers em `src/services/zelomenuAdminApi.ts`

Mesmo estilo de `getZeloMenuSettings`/`updateZeloMenuSettings` (linhas
69–86): usam `authHeader()` e `parseResponse<T>`.

```ts
export type ZeloMenuCoupon = {
  id: string;
  code: string;
  discountType: 'valor' | 'percentual' | 'frete_gratis';
  discountValue: number | null;
  minOrderValue: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
};

export type ZeloMenuCouponInput = Omit<ZeloMenuCoupon, 'id'>;

export async function listZeloMenuCouponsAdmin(): Promise<ZeloMenuCoupon[]> {
  const response = await fetch('/api/admin/zelomenu/coupons', { headers: await authHeader(), cache: 'no-store' });
  const body = await parseResponse<{ coupons: ZeloMenuCoupon[] }>(response);
  return body.coupons;
}

export async function createZeloMenuCouponAdmin(input: ZeloMenuCouponInput): Promise<ZeloMenuCoupon> {
  const response = await fetch('/api/admin/zelomenu/coupons', { method: 'POST', headers: await authHeader(), body: JSON.stringify(input) });
  return parseResponse<ZeloMenuCoupon>(response);
}

export async function updateZeloMenuCouponAdmin(id: string, patch: Partial<ZeloMenuCouponInput>): Promise<ZeloMenuCoupon> {
  const response = await fetch(`/api/admin/zelomenu/coupons/${encodeURIComponent(id)}`, { method: 'PATCH', headers: await authHeader(), body: JSON.stringify(patch) });
  return parseResponse<ZeloMenuCoupon>(response);
}

export async function deleteZeloMenuCouponAdmin(id: string): Promise<{ ok: true }> {
  const response = await fetch(`/api/admin/zelomenu/coupons/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeader() });
  return parseResponse<{ ok: true }>(response);
}
```

`ERROR_MESSAGES` (linhas 45–50) ganha entradas em PT-BR:
```ts
  COUPON_CODE_TAKEN: 'Este código já está em uso.',
  COUPON_INVALID_CODE: 'Código inválido. Use letras, números e hífen (3 a 30 caracteres).',
  COUPON_INVALID_DISCOUNT_VALUE: 'Valor de desconto inválido para o tipo escolhido.',
  COUPON_NOT_FOUND: 'Cupom não encontrado.',
```

---

## 5. Checkout UI + autofill

### 5.1 Input de cupom (Passo 3, `ZeloMenuCartPage.tsx`)

Inserir entre o fim do bloco "Observações" (linha 1352, fecha o `</label>`) e
o início do bloco "Resumo" (linha 1354, `<div className="flex items-center
gap-2 text-[13px] font-semibold">` com o ícone `ShoppingCart`):

- Novo estado local: `const [couponInput, setCouponInput] = useState('');` e
  `const [couponApplying, setCouponApplying] = useState(false);`
  inicializados perto dos outros `useState` do componente (linhas 309–319).
- Campo de texto + botão "Aplicar". Ao clicar: chama
  `updatePublicCart(token, { ...buildCartUpdatePayload(draft, scheduleMode, payload.session.revision), couponCode: couponInput })`.
  - Sucesso (`response.revalidation.issues` sem nenhum `coupon_*`): atualiza
    `payload`/`draft`/`scheduleMode` como já faz o autosave (mesmo padrão das
    linhas 600–602), mostra toast de sucesso.
  - Erro (`ZeloMenuApiError` com `code` em
    `COUPON_INVALID`/`COUPON_EXPIRED`/`COUPON_MIN_NOT_MET`, ou revalidation
    com issue de código `coupon_*`): mostra toast/inline com a mensagem, **não
    altera o resto do estado do carrinho** — o carrinho permanece exatamente
    como estava antes de tentar aplicar. O usuário pode continuar o checkout
    sem cupom.
- Se já existe cupom aplicado (`payload.session.pricing.couponCode`), o campo
  mostra o código aplicado com um "x" para remover (PATCH com
  `couponCode: null`).

### 5.2 Linha de desconto no bloco Resumo (linhas 1358–1374)

Entre a linha "Entrega/Retirada" (linhas 1363–1368) e a linha "Total"
(linhas 1369–1372), quando `estimated.discount > 0`:

```tsx
{estimated.discount > 0 ? (
  <div className="flex items-center justify-between text-[13px] font-semibold text-[var(--color-brand-deep)]">
    <span>Cupom {payload.session.pricing.couponCode}</span>
    <span className="tabular-nums">−{toBRL(estimated.discount)}</span>
  </div>
) : null}
```

A linha "Total" (linha 1370-1371) passa a usar `estimated.total` (que já
subtrai o desconto, conforme seção 2.5) em vez de `estimated.total` antigo
(sem desconto) — a variável já se chama `estimated.total`, só o cálculo por
trás muda.

### 5.3 Footer fixo (`footValue`/`footSub`, linhas 819–830, e render em 1411–1413)

`footValue` (linha 819) já deriva de `estimated.total`/`estimated.subtotal` —
como o desconto passa a estar embutido em `estimated.total`, `footValue` já
reflete o desconto sem mudança de código, desde que a chamada de
`estimateDraftTotals` (seção 2.5) esteja recebendo o cupom aplicado. Ajustar
apenas `footSub` (linhas 825–830) para mencionar o desconto quando houver:

```ts
  let footSub = '';
  if (!isDelivery) footSub = 'Retirada · sem taxa';
  else if (feeToConfirm) footSub = '+ entrega a confirmar';
  else if (fee === 0) footSub = 'Entrega grátis';
  else footSub = `inclui ${toBRL(fee)} de entrega`;
  if (estimated.discount > 0) footSub += ` · cupom −${toBRL(estimated.discount)}`;
```

### 5.4 Erros de cupom em PT-BR

Reaproveita o mecanismo já existente de toast por issue de revalidação
(`buildRevalidationToastMessage`, linhas 253–262, e o fluxo de
`updateIssues`/`finalIssues` nas linhas 596–614) — como os 4 códigos novos
entram no mesmo union `ZeloMenuCartRevalidationIssue`, eles já aparecem
automaticamente no toast genérico (`firstIssue?.message`) sem precisar de
nenhum código extra no componente. Único ajuste opcional: adicionar um branch
específico em `buildRevalidationToastMessage`, espelhando o de
`price_changed` (linha 254), se o time quiser uma frase mais amigável para
cupom — não é obrigatório para o MVP funcionar.

### 5.5 Autofill (Camada 1, device-local)

Novo arquivo `src/domain/zelomenuCustomerCache.ts`, espelhando
`src/domain/zelomenuStoreCartCache.ts` (TTL 30 dias em vez de 12h):

```ts
const CUSTOMER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ZeloMenuCustomerCache = {
  name: string;
  phone: string;
  deliveryAddress: string;
  deliveryNeighborhood: string;
};

function zeloMenuCustomerStorageKey(slug: string): string {
  return `zelomenu_customer_${slug}`;
}

export function loadZeloMenuCustomerCache(slug: string): ZeloMenuCustomerCache | null {
  if (!slug) return null;
  try {
    const raw = localStorage.getItem(zeloMenuCustomerStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number } & Partial<ZeloMenuCustomerCache>;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CUSTOMER_CACHE_TTL_MS) {
      localStorage.removeItem(zeloMenuCustomerStorageKey(slug));
      return null;
    }
    if (!parsed.name && !parsed.phone && !parsed.deliveryAddress) return null;
    return {
      name: parsed.name ?? '',
      phone: parsed.phone ?? '',
      deliveryAddress: parsed.deliveryAddress ?? '',
      deliveryNeighborhood: parsed.deliveryNeighborhood ?? '',
    };
  } catch {
    return null;
  }
}

export function saveZeloMenuCustomerCache(slug: string, data: ZeloMenuCustomerCache): void {
  if (!slug) return;
  try {
    localStorage.setItem(zeloMenuCustomerStorageKey(slug), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // localStorage indisponível — autofill é um extra, não crítico.
  }
}
```

**Leitura (prefill):** `buildDraftFromPayload` (linhas 108–133) ganha um
segundo parâmetro opcional e usa o cache só para campos que o servidor
devolveu vazios (uma sessão nova sempre tem `customer.name`/`phone`/
`fulfillment.deliveryAddress` nulos, porque
`useStoreCart.ts:109-117`/`startPublicOrder` nunca envia esses campos na
criação do carrinho — são preenchidos só aqui, no Passo 2):

```ts
function buildDraftFromPayload(
  payload: ZeloMenuPublicCartResponse,
  customerCache?: ZeloMenuCustomerCache | null,
): DraftState {
  const cache = customerCache ?? null;
  return {
    customerName: payload.session.customer.name || cache?.name || '',
    customerPhone: maskBrazilianPhone(payload.session.customer.phone || cache?.phone || ''),
    // ...items inalterado (linhas 112-124)...
    fulfillmentType: payload.session.fulfillment.type,
    pickupDate: payload.session.fulfillment.pickupDate ?? todayISOdate(),
    pickupTime: payload.session.fulfillment.pickupTime ?? nowTimeBR(),
    deliveryAddress: payload.session.fulfillment.deliveryAddress || cache?.deliveryAddress || '',
    deliveryNeighborhood: payload.session.fulfillment.deliveryNeighborhood || cache?.deliveryNeighborhood || '',
    paymentMethod: payload.session.payment.declaredMethod ?? '',
    observations: payload.session.cart.observations ?? '',
  };
}
```

Chamador em `load()` (linha 338, dentro de `mode === 'initial'` apenas — uma
`refresh` não deve reaplicar o cache por cima de edições em progresso):

```ts
      const next = await getPublicCart(token);
      if (requestId !== loadRequestRef.current) return;
      if (mode === 'refresh') revalidationToastShownRef.current = '';
      setPayload(next);
      const slug = typeof next.session.metadata.slug === 'string' ? next.session.metadata.slug : null;
      const cache = mode === 'initial' ? loadZeloMenuCustomerCache(slug ?? '') : null;
      setDraft(buildDraftFromPayload(next, cache));
```

Novo import no topo do arquivo (perto da linha 52, junto de
`syncZeloMenuStoreCartCache`):
```ts
import { loadZeloMenuCustomerCache, saveZeloMenuCustomerCache } from '../domain/zelomenuCustomerCache';
```

**Escrita (salvar após sucesso):** dentro do bloco
`if (next.confirmation.confirmed) { ... }` (linhas 618–625), só para
`context === 'public_order'` (mesa não usa autofill):

```ts
      if (next.confirmation.confirmed) {
        if (next.session.context === 'public_order') {
          const slug = typeof next.session.metadata.slug === 'string' ? next.session.metadata.slug : null;
          if (slug) {
            saveZeloMenuCustomerCache(slug, {
              name: draft.customerName,
              phone: draft.customerPhone,
              deliveryAddress: draft.deliveryAddress,
              deliveryNeighborhood: draft.deliveryNeighborhood,
            });
          }
        }
        toast.success(/* inalterado */);
      }
```

**Sem endpoint de busca por telefone no servidor** — decisão de segurança
deliberada: evita permitir enumeração de PII (nome/endereço de clientes) só
digitando números de telefone na vitrine pública. O autofill é 100%
client-side, restrito ao aparelho que já fez o pedido.

---

## 6. Erros e bordas

- **`frete_gratis` com retirada (sem entrega):** `deliveryFee` já é `0` para
  `fulfillmentType === 'pickup'` (linha 622 em `computeCartPricing` no server
  e linha 189-193 em `estimateDraftTotals` no client, via
  `resolveDeliveryFeeForNeighborhood`), então `applyCoupon` já devolve
  `discount: 0` automaticamente — não precisa de nenhum código de issue novo
  para isso. Para dar "mensagem clara" sem inventar um 5º código de
  revalidação (o escopo fixou 4), a UI mostra um aviso **inline**, não um
  erro bloqueante: quando `!isDelivery && payload.session.pricing.couponCode
  && payload.session.pricing.couponDiscountType === 'frete_gratis'`, exibir
  sob a linha do cupom (seção 5.2): `"Este cupom vale só para entrega — não
  se aplica à retirada."`. O cupom continua "aplicado" (não é removido), só
  não desconta nada enquanto o pedido for retirada.
- **Cupom fica inválido/expirado/esgotado entre aplicar e confirmar:** a
  revalidação (`resolveSnapshots`, chamada tanto no PATCH quanto no confirm
  via `runRevalidation`) sinaliza o issue correspondente, exatamente como já
  acontece hoje para preço/estoque — nenhum mecanismo novo além dos códigos
  em `cartIssueFromError`.
- **Total nunca negativo:** garantido por construção em `applyCoupon`
  (client) e `computeCartPricing` (server) — ambos fazem
  `Math.max(0, Math.min(discount, subtotal + deliveryFee))` antes de calcular
  `total`.
- **Telefone normalizado:** `normalizePhoneNumber` (`src/domain/chat.ts:1`)
  usado tanto no resgate (`server/zelomenuCartSessions.ts`, dentro de
  `confirmPublicCartSession`) quanto implicitamente no autofill (o cache
  guarda o valor mascarado/exibido — `maskBrazilianPhone` — que já é o mesmo
  formato do input; a normalização para dígitos só importa no servidor, na
  hora de gravar `zelomenu_coupon_redemptions.customer_phone`).

---

## 7. Testes

### 7.1 `src/domain/zelomenuCoupon.test.ts` (novo, mesma pasta/convenção de
`zelomenuCheckout.test.ts`)

Casos obrigatórios (rodam com `npm test`, vitest):
- `applyCoupon` tipo `valor`: desconto = valor do cupom quando `<= subtotal`.
- `applyCoupon` tipo `valor`: clampa para o subtotal quando o valor do cupom
  é maior que o subtotal.
- `applyCoupon` tipo `percentual`: desconto = `round(subtotal * pct / 100)`.
- `applyCoupon` tipo `frete_gratis`: desconto = `deliveryFee`; e
  `deliveryFee = 0` (retirada) → desconto `0`.
- `applyCoupon`: clamp de total ≥ 0 mesmo com `discount_value` absurdamente
  alto.
- `validateCouponRule`: pedido mínimo não atingido → `coupon_min_not_met`.
- `validateCouponRule`: `now` antes de `starts_at` → `coupon_expired`.
- `validateCouponRule`: `now` depois de `expires_at` → `coupon_expired`.
- `validateCouponRule`: `active: false` → `coupon_invalid`.
- `validateCouponRule`: `coupon: null` → `coupon_invalid`.
- `normalizeCouponCode`: aceita `"promo10"` → `"PROMO10"`; rejeita string
  vazia, menor que 3 chars, maior que 30, ou com caracteres fora de
  `A-Z0-9-`.

### 7.2 Servidor

- Unicidade de resgate: dois `reserveCouponRedemption` com o mesmo
  `(couponId, customerPhone)` — o segundo deve retornar `{ ok: false }`
  (não lançar).
- Os 4 códigos de revalidação (`coupon_invalid`, `coupon_expired`,
  `coupon_min_not_met`, `coupon_already_used`) aparecem corretamente no fluxo
  de `resolveSnapshots`/`confirmPublicCartSession` (pode ser teste de
  integração com Supabase local, ou teste unitário de `cartIssueFromError`
  isolado — mínimo aceitável para o MVP é cobrir `cartIssueFromError` com os
  3 primeiros códigos, já que são puramente uma tabela de tradução).

### 7.3 E2E (opcional, `e2e/` já usa Playwright — ver `e2e/cart-flow.spec.ts`
como referência de estilo)

Novo spec `e2e/coupon-checkout.spec.ts`: aplicar um cupom válido no Passo 3
do checkout e verificar que a linha "Cupom {code} −R$X" aparece no Resumo e
que o total exibido no footer reflete o desconto.

---

## Pontos de integração (mapa de arquivos)

| Arquivo | Papel |
|---|---|
| `supabase/migrations/20260718140000_zelomenu_coupons.sql` | Migração nova: tabelas `zelomenu_coupons` e `zelomenu_coupon_redemptions`, RLS, constraints. |
| `src/domain/zelomenuCoupon.ts` | **Novo.** Fonte única de pricing: `applyCoupon`, `validateCouponRule`, `normalizeCouponCode`. Importado idêntico no client e no server. |
| `src/domain/zelomenuCoupon.test.ts` | **Novo.** Testes vitest da lógica pura acima. |
| `src/domain/zelomenuCartSchema.ts` | Estende `ZeloMenuPricingSnapshot` (`discount`, `couponCode`, `couponDiscountType`, `couponDiscountValue`) e o union `ZeloMenuCartRevalidationIssue` (4 códigos novos). |
| `src/domain/zelomenuCustomerCache.ts` | **Novo.** Cache localStorage do autofill (nome/telefone/endereço por slug, TTL 30 dias). |
| `src/domain/chat.ts` | Já existe — `normalizePhoneNumber`, reusado no resgate de cupom (server) e indiretamente no autofill. |
| `src/services/zelomenuApi.ts` | Estende `ZeloMenuCartSessionPayload.pricing` (duplicata inline do schema — precisa do mesmo ajuste) e `ZeloMenuUpdateCartPayload` (`couponCode`). |
| `src/services/zelomenuAdminApi.ts` | Wrappers admin novos: `listZeloMenuCouponsAdmin`, `createZeloMenuCouponAdmin`, `updateZeloMenuCouponAdmin`, `deleteZeloMenuCouponAdmin`, + entradas em `ERROR_MESSAGES`. |
| `src/components/zelomenu/ZeloMenuCouponsCard.tsx` | **Novo.** Painel admin de cupons (lista + criar/editar/soft-delete), estilo `ZeloMenuSettingsCard.tsx`. |
| `src/pages/ZeloMenuCartPage.tsx` | `estimateDraftTotals` (desconto local), `buildDraftFromPayload` (autofill), input de cupom no Passo 3, linha de desconto no Resumo, `footSub`, salvar cache após confirmação. |
| `server/zelomenuCoupons.ts` | **Novo.** CRUD admin + `findActiveCouponByCode`/`reserveCouponRedemption`/`attachOrderToRedemption`/`releaseCouponRedemption`. Sem dependência de `zelomenuCartSessions.ts` (evita import circular). |
| `server/zelomenuCartSessions.ts` | `computeCartPricing`, `resolveSnapshots` (3 chamadores), `cartIssueFromError`, `parsePricingSnapshot`, `confirmPublicCartSession` (reserva/rollback do resgate). |
| `server/index.ts` | 4 rotas novas `GET/POST/PATCH/DELETE /api/admin/zelomenu/coupons[/:id]`, mais 3 branches em `sendAdminError`. |
| `server/supabaseServer.ts` | Sem alteração — `requireEmpresaId`/`getEmpresaUserId` já existentes são reusados para a conversão `empresaId → ownerUserId`. |
| `src/domain/zeloCanonicalOrder.ts` | Sem alteração — já repassa `pricing` inteiro para o RPC. |
| `e2e/coupon-checkout.spec.ts` | Novo (opcional) — E2E do fluxo de aplicar cupom no checkout. |

---

## Ambiguidades resolvidas durante a escrita deste spec

1. **`id_usuario` vs `empresa_id`:** o brainstorming pedia para seguir o
   template de `zelomenu_modifier_groups` (chave `id_usuario`), mas as rotas
   Express resolvem `empresaId`. Resolvido explicitando em toda parte
   relevante (seção 1, 3, 4) que o servidor deve converter com
   `getEmpresaUserId(empresaId)` antes de tocar nas tabelas novas — mesmo
   padrão já usado em `server/index.ts:292` e `:312` para as rotas de mesas.
2. **Onde mora a lógica de resgate/CRUD no server:** o brainstorming não
   especificava um arquivo. Decidido criar `server/zelomenuCoupons.ts`
   separado, em vez de inchar ainda mais `zelomenuCartSessions.ts` (já tem
   1243 linhas) — sem risco de import circular, já que só depende de
   `supabaseServer.ts`.
3. **Cliente recalculando o desconto localmente:** o brainstorming dizia
   "estimateDraftTotals importa a mesma applyCoupon" mas `applyCoupon`
   precisa do tipo/valor do cupom, que só o servidor conhece. Resolvido
   ecoando `couponDiscountType`/`couponDiscountValue` (além de `couponCode`)
   no `ZeloMenuPricingSnapshot` devolvido pelo servidor, para o cliente
   reconstruir o mesmo cálculo sem precisar de outro round-trip a cada
   keystroke.
4. **`coupon_already_used` não nasce de um erro de `resolveSnapshots`:** os
   outros 3 códigos vêm de `cartIssueFromError` traduzindo uma `Error`
   lançada dentro de `resolveSnapshots`. "Já usado" só é conhecido no momento
   do resgate (dentro de `confirmPublicCartSession`, depois da revalidação
   normal), então esse código é construído manualmente ali, reaproveitando o
   mesmo objeto `ZeloMenuCartRevalidation` e o mesmo caminho de resposta
   (`confirmed: false`) que os outros 3.
5. **`frete_gratis` + retirada:** o brainstorming pedia "mensagem clara" sem
   prever um 5º código de revalidação (o escopo fixa 4 códigos). Resolvido
   como aviso inline no client (não bloqueante, não um issue de servidor) —
   o cupom continua aplicado, só não desconta nada nesse caso.
6. **Semântica de "excluir" no admin:** o brainstorming dizia "criar/editar/
   excluir por linha" sem definir se é hard ou soft delete. Resolvido como
   soft-delete (`active=false`) para preservar a integridade do histórico em
   `zelomenu_coupon_redemptions` (FK `on delete cascade` apagaria os resgates
   junto se a linha do cupom fosse removida de verdade).
7. **Normalização de código evitando `ILIKE`:** decidido normalizar
   (`trim().toUpperCase()`, charset `A-Z0-9-`) tanto na escrita quanto na
   leitura e usar sempre `.eq('code', normalizado)` — nunca `ilike`/`like` —
   porque o charset permitido não pode conter `_`/`%`, que teriam significado
   especial em `LIKE`.
