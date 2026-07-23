# Pix Copia e Cola com valor por pedido — Design

**Data:** 2026-07-23
**Status:** Aprovado para implementação (aguardando review do spec)

## Objetivo

Quando o cliente escolhe **Pix** no carrinho e confirma o pedido, mostrar um
**Pix Copia e Cola** (BR Code EMV) já com o **valor do pedido embutido**, montado a
partir da **chave Pix da loja**. Se a loja não tem chave cadastrada (vazia/null),
o passo simplesmente não aparece — nada muda no fluxo atual.

Isso facilita o andamento do pedido: o cliente copia o código, paga no banco dele,
e (quando a loja usa validação de comprovante do ZeloChat) envia o comprovante.

## Contexto do banco (verificado no projeto ZeloPDV linkado)

- A chave já é armazenada em **`empresa_perfil.chave_pix`** (`text`). É a coluna
  que o **ZeloChat** já edita hoje. Fonte única da chave — não vamos duplicar.
- Hoje: 5 de 18 lojas têm `chave_pix` preenchida; **todas com 11 dígitos puros**
  (sem `+55`, sem pontuação).
- **Não existe** coluna de "tipo de chave". Um valor de 11 dígitos é ambíguo:
  pode ser **CPF** (11 díg) ou **celular** (DDD+9+8 = 11 díg).
- Existe `empresa_perfil.pix_receipt_config` (`jsonb`), mas é da feature de
  **validação de comprovante** do ZeloChat (beneficiaryNames, tolerâncias). Não
  serve para gerar o copia e cola e **não** é pré-requisito deste recurso.

## Decisões (tomadas no brainstorming)

1. **Tipo da chave: o merchant declara.** Sem chute. Um seletor
   (CPF / Celular / E-mail / CNPJ / Aleatória) resolve a ambiguidade dos 11 dígitos.
2. **Admin: card compartilhado no ZeloMenu** para editar a chave + tipo. Grava na
   **mesma** `empresa_perfil.chave_pix` (fica em sincronia com o ZeloChat) + nova
   coluna de tipo. Motivo: 13/18 lojas ainda não têm chave; assim configuram sem
   depender de outro app.
3. **Cliente vê só o Copia e Cola** (sem QR). Mobile-first: o cliente já está no
   celular, então copiar > escanear a própria tela. `qrcode` já existe nas deps
   caso queiram QR no futuro, mas fora do escopo agora.
4. **Geração à mão + TDD**, módulo puro, zero dependência nova. A parte de
   CRC16/TLV é 100% especificada pelo BACEN e fica travada por testes com vetores
   conhecidos. Evita arrastar `axios`/`yup` para um caminho de dinheiro.
5. **Código montado no servidor**, usando o **total travado da sessão** (mais
   confiável que a estimativa do client).

## Nota de correção (dinheiro / regras Fanvue)

Isto gera um **pedido de pagamento** (cliente → loja), que a pessoa confirma no
próprio app do banco. **Não** é payout automático, não chama endpoint de
tesouraria, não inicia transferência. O ponto crítico de corretude é o **formato
da chave** no campo 26 — resolvido por (a) tipo declarado pelo merchant e (b)
validação chave × tipo no admin. Antes de considerar pronto, **verificar com um
pagamento real de teste** que o código é aceito pelo banco.

`chave_pix` é a chave da própria loja, exibida aos clientes dela na vitrine dela —
uso pretendido, não exposição de PII de terceiros. Nada de chave em logs.

## Arquitetura

### 1. Domínio puro — `src/domain/pixBrCode.ts` (novo, sem deps)

Segue o padrão de `src/domain/*` (sem React/DB/rede). Exporta:

```ts
export type PixKeyType = 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';

export function normalizePixKey(key: string, type: PixKeyType): string;
export function isValidPixKeyForType(key: string, type: PixKeyType): boolean;

export function buildPixBrCode(input: {
  key: string;
  keyType: PixKeyType;
  merchantName: string;
  merchantCity: string;
  amount: number;         // em reais, > 0
  txid?: string;          // default '***'
}): string;
```

**Formatação da chave por tipo (`normalizePixKey`):**
- `cpf` → só dígitos (11)
- `cnpj` → só dígitos (14)
- `phone` → `+55` + DDD + número em E.164 (remove não-dígitos; garante prefixo `+55`)
- `email` → trim + minúsculo
- `random` (EVP) → como está (UUID)

**Campos EMV (TLV) montados:**
| ID | Conteúdo |
|----|----------|
| 00 | Payload Format Indicator = `01` |
| 01 | Point of Initiation = `11` (estático) |
| 26 | Merchant Account Info: `00`=`br.gov.bcb.pix`, `01`=chave normalizada |
| 52 | MCC = `0000` |
| 53 | Moeda = `986` (BRL) |
| 54 | Valor = `amount.toFixed(2)` (ponto decimal) |
| 58 | País = `BR` |
| 59 | Nome recebedor: ASCII-fold + maiúsculo, ≤ 25 |
| 60 | Cidade: ASCII-fold + maiúsculo, ≤ 15 |
| 62 | Additional Data: `05`=txid (`***` default) |
| 63 | CRC16-CCITT (poly `0x1021`, init `0xFFFF`) sobre o payload + `6304` |

- `merchantName` vem de `empresa_perfil.nome_exibicao`; fallback `LOJA`.
- `merchantCity` derivada de `empresa_perfil.endereco` (best-effort); fallback
  constante. Cidade é informativa — não quebra o pagamento se imprecisa.

**Testes (`src/domain/pixBrCode.test.ts`) — TDD, escrever primeiro:**
- CRC16 de vetor conhecido do manual BACEN.
- Um `buildPixBrCode` por tipo de chave → string esperada byte a byte
  (comparada com saída de referência) + CRC válido.
- `normalizePixKey`: 11 dígitos como `cpf` (crus) vs `phone` (`+55…`).
- `isValidPixKeyForType`: casos válidos/ inválidos por tipo.

### 2. Backend

**`server/configStore.ts`:**
- Incluir `chave_pix` e `zelomenu_pix_key_type` no `PERFIL_BASE_COLUMNS` (ou via
  select tolerante a coluna ausente, como o `horario_semanal`).
- Expor em `BusinessConfig`: `pixPayment: { key: string; keyType: PixKeyType } | null`
  (null quando chave vazia OU tipo ausente).

**`server/zelomenuCartSessions.ts`:**
- No payload do carrinho, popular **`session.payment.pixCopyPaste: string | null`**.
- Preenche quando: método declarado é Pix (`isPixPaymentMethod`) **E**
  `config.pixPayment` não-null **E** total da sessão > 0. Caso contrário `null`.
- Usa o **total travado** de `session.pricing.total`, chamando `buildPixBrCode` com
  `merchantName`/`merchantCity` do config.
- Independente de `pix_receipt_config` (não depende do ZeloChat).

**Settings admin — `get/updateZeloMenuStoreSettings`:**
- `get`: retornar `pixKey` (de `empresa_perfil.chave_pix`) e `pixKeyType`
  (de `zelomenu_pix_key_type`).
- `update`: aceitar `pixKey` e `pixKeyType`; gravar `chave_pix` (compartilhado) e
  `zelomenu_pix_key_type`. **Fallback gracioso** se a coluna de tipo ainda não
  existe (mesmo padrão do `isMissingZeloMenuRecommendationColumn`).
- Validar `pixKey` × `pixKeyType` no servidor com `isValidPixKeyForType` antes de
  gravar; rejeitar com erro em PT-BR se não bater.

**Rota (`server/index.ts`):** estender o handler existente
`PATCH /api/admin/zelomenu/settings` para aceitar `pixKey`/`pixKeyType` (ou rota
dedicada se ficar mais limpo). Sem novo endpoint público.

### 3. Frontend cliente — `src/pages/ZeloMenuCartPage.tsx`

Na tela de **pedido confirmado** (`isConfirmed && !isTableOrder`), quando
`payload.session.payment.pixCopyPaste` presente e método = Pix:
- Card com **valor em destaque**, o código em fonte mono (com quebra), e botão
  **"Copiar código Pix"** (`navigator.clipboard.writeText` + toast de sucesso;
  fallback de seleção se clipboard indisponível).
- Posicionado junto da mensagem "envie o comprovante do Pix no WhatsApp".
- Se `pixCopyPaste` é null → não renderiza nada (passo some, sem regressão).

Tipos em `src/services/zelomenuApi.ts`: adicionar `pixCopyPaste: string | null`
em `session.payment`.

### 4. Admin — card "Pagamento via Pix"

Novo componente (ex.: `src/components/zelomenu/ZeloMenuPixCard.tsx`) ou seção no
`ZeloMenuSettingsCard.tsx`:
- Campo de texto da chave + seletor de tipo (segmented: CPF/Celular/E-mail/CNPJ/Aleatória).
- Validação client-side (`isValidPixKeyForType`) com mensagem PT-BR; botão salvar
  desabilitado se inválido.
- Salva via `updateZeloMenuSettings` (estendido) — `zelomenuAdminApi.ts` ganha
  `pixKey`/`pixKeyType` em `ZeloMenuStoreSettings`.
- Segue o visual dos outros cards (toggle/pills, tap targets 44px, cores da marca).

### 5. Migration — `supabase/migrations/<ts>_zelomenu_pix_key_type.sql`

```sql
alter table public.empresa_perfil
  add column if not exists zelomenu_pix_key_type text;
```

`chave_pix` já existe — não mexer. Coluna nova é ZeloMenu-owned (prefixo segue o
padrão das outras `zelomenu_*`); ZeloChat pode ler no futuro se quiser.

## Fora de escopo (YAGNI)

- QR Code escaneável (deps já suportam; adicionar depois se pedirem).
- txid = orderingId para reconciliação (usar `***` por compatibilidade; avaliar
  depois). Reconciliação continua humana.
- Split de pagamento / confirmação automática de pagamento (não é payout).
- UI de tipo de chave no ZeloChat (pode adotar a coluna depois).

## Critérios de aceite

1. Loja sem `chave_pix` → nenhuma mudança no fluxo (passo Pix ausente).
2. Loja com chave + tipo + pedido Pix confirmado → card com valor correto e botão
   copiar funcionando.
3. BR Code gerado passa em pagamento real de teste no banco (CRC + chave aceitos).
4. Admin valida chave × tipo e mantém `chave_pix` em sincronia com o ZeloChat.
5. `npm run lint` e `npm test` limpos; testes novos do `pixBrCode` passando.
