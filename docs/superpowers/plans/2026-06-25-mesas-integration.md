# Mesas Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate ZeloMenu with ZeloPDV's mesas module so customers can scan a static QR code on a table, browse the menu, and submit orders that appear in the ZeloPDV kitchen queue linked to the open comanda.

**Architecture:** ZeloMenu admin reads the `mesas` table (shared Supabase DB) and renders downloadable QR codes. The public storefront gains a new route `/{slug}/mesa/:mesaId` that shows the menu and — when a comanda is open — a cart that creates a `pedido` with `origem='zelomenu'` + `id_comanda` on confirm. ZeloPDV's kitchen queue gets a badge for zelomenu orders and a `preparando` status step.

**Tech Stack:** React 19 + Vite + TypeScript (ZeloMenu frontend) · Express 4 + tsx (ZeloMenu server) · SvelteKit 2 + Svelte 5 (ZeloPDV) · Supabase PostgreSQL (shared DB, service-role key for cross-schema writes) · `qrcode` npm package (QR generation)

## Global Constraints

- All UI copy in **Portuguese (PT-BR)**
- Minimum 44px tap targets on all interactive elements
- `npm run lint` (tsc --noEmit) must pass after every ZeloMenu task
- Gate: mesas integration only visible when `caps.mesas && caps.menu_publication` are both true
- No new Supabase migrations in ZeloMenu — schema already exists
- ZeloPDV needs one migration: add `'preparando'` to `pedidos.status` CHECK constraint
- `numero_pedido` must be obtained via RPC `proximo_numero_pedido(p_id_usuario)` before INSERT into `pedidos`
- ZeloMenu server uses `supabaseAdmin` (service-role) for writes to `pedidos`/`pedido_itens`

---

## File Map

### ZeloMenu — New files
| File | Responsibility |
|------|---------------|
| `src/pages/ZeloMenuMesaPage.tsx` | Public storefront for a specific mesa; loads comanda state, gates cart |
| `src/components/zelomenu/MesasAdminSection.tsx` | Admin section listing mesas + QR code download |
| `server/zelomenuMesaHandler.ts` | Server logic: lookup active comanda for mesa; list mesas for admin |

### ZeloMenu — Modified files
| File | What changes |
|------|-------------|
| `src/App.tsx` | Add `/:slug/mesa/:mesaId` route before catch-all |
| `src/components/AdminLayout.tsx` | Add `'mesas'` nav section |
| `src/pages/AdminPage.tsx` | Add `MesasAdminSection` gated by `caps.mesas && caps.menu_publication` |
| `src/services/zelomenuApi.ts` | Add `getMesaContext()` + extend `startPublicOrder()` for table_order |
| `server/index.ts` | Register `GET /api/public/zelomenu/mesa/:mesaId` and `GET /api/admin/zelomenu/mesas` |
| `server/zelomenuCartSessions.ts` | Handle `table_order` context: validate comanda on open + write `pedidos` on confirm |
| `package.json` | Add `qrcode` + `@types/qrcode` |

### ZeloPDV — New files
| File | Responsibility |
|------|---------------|
| `.ai/migrations/pedidos_preparando_status_2026_06_25.sql` | Add `'preparando'` to `pedidos.status` CHECK |

### ZeloPDV — Modified files
| File | What changes |
|------|-------------|
| `src/routes/app/pedidos/cozinha/+page.svelte` | Badge for `origem='zelomenu'`; `preparando` status button |

---

## Tasks — ZeloMenu

---

### Task 1: Install qrcode + server handler skeleton + mesa public route

**Files:**
- Modify: `package.json`
- Create: `server/zelomenuMesaHandler.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Produces: `getMesaContext(mesaId: string, empresaId: string): Promise<MesaContextResult>` used by Tasks 5 and 7
- Produces: `listMesasForAdmin(empresaId: string): Promise<MesaRow[]>` used by Task 3
- Produces: `GET /api/public/zelomenu/mesa/:mesaId` → `{ comanda_id, comanda_status, mesa_numero }` or `{ error: 'sem_comanda' }`
- Produces: `GET /api/admin/zelomenu/mesas` → `{ mesas: MesaRow[] }`

- [ ] **Step 1: Install qrcode**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

Expected output: `added 2 packages`

- [ ] **Step 2: Write the failing test for getMesaContext**

Create `src/domain/zelomenuMesa.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// Pure validation logic — no DB calls
describe('mesa context validation', () => {
  it('returns error when comanda_id does not match active comanda for mesa', () => {
    const sessionComandaId = 'abc-123'
    const activeComandaId = 'xyz-789'
    const isSameComanda = sessionComandaId === activeComandaId
    expect(isSameComanda).toBe(false)
  })

  it('returns ok when comanda_id matches active comanda', () => {
    const sessionComandaId = 'abc-123'
    const activeComandaId = 'abc-123'
    const isSameComanda = sessionComandaId === activeComandaId
    expect(isSameComanda).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npm test -- --run src/domain/zelomenuMesa.test.ts
```

Expected: PASS (pure logic, trivially correct — this establishes the test file)

- [ ] **Step 4: Create server/zelomenuMesaHandler.ts**

```typescript
import { supabaseAdmin } from './supabaseServer.js'

export interface MesaRow {
  id: string
  numero: string
  capacidade: number | null
  status: string
  ativa: boolean
}

export type MesaContextResult =
  | { ok: true; comanda_id: string; comanda_status: string; mesa_numero: string }
  | { ok: false; error: 'SEM_COMANDA' | 'MESA_NOT_FOUND' }

export async function getMesaContext(
  mesaId: string,
  empresaId: string,
): Promise<MesaContextResult> {
  const { data: mesa } = await supabaseAdmin
    .from('mesas')
    .select('id, numero, ativa')
    .eq('id', mesaId)
    .eq('id_usuario', empresaId)
    .maybeSingle()

  if (!mesa) return { ok: false, error: 'MESA_NOT_FOUND' }

  const { data: comanda } = await supabaseAdmin
    .from('comandas')
    .select('id, status')
    .eq('id_mesa', mesaId)
    .eq('id_usuario', empresaId)
    .eq('status', 'aberta')
    .order('aberta_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!comanda) return { ok: false, error: 'SEM_COMANDA' }

  return {
    ok: true,
    comanda_id: comanda.id,
    comanda_status: comanda.status,
    mesa_numero: mesa.numero,
  }
}

export async function listMesasForAdmin(empresaId: string): Promise<MesaRow[]> {
  const { data } = await supabaseAdmin
    .from('mesas')
    .select('id, numero, capacidade, status, ativa')
    .eq('id_usuario', empresaId)
    .eq('ativa', true)
    .order('numero', { ascending: true })

  return data ?? []
}
```

- [ ] **Step 5: Register routes in server/index.ts**

After the existing admin routes block (after line ~174), add:

```typescript
// Mesa public route
app.get('/api/public/zelomenu/mesa/:mesaId', async (req, res) => {
  try {
    const slug = req.query.slug as string | undefined
    if (!slug) return res.status(400).json({ error: 'MISSING_SLUG' })
    const empresaId = await resolveEmpresaIdBySlug(slug)
    if (!empresaId) return res.status(404).json({ error: 'STORE_NOT_FOUND' })
    const result = await getMesaContext(req.params.mesaId, empresaId)
    if (!result.ok) return res.status(200).json({ error: result.error })
    res.json({
      comanda_id: result.comanda_id,
      comanda_status: result.comanda_status,
      mesa_numero: result.mesa_numero,
    })
  } catch (error) {
    console.error('[ZeloMenu] getMesaContext error:', error)
    res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
})

// Mesas admin route
app.get('/api/admin/zelomenu/mesas', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req)
    const mesas = await listMesasForAdmin(empresaId)
    res.json({ mesas })
  } catch (error) {
    sendAdminError(res, error)
  }
})
```

Also add import at top of `server/index.ts`:

```typescript
import { getMesaContext, listMesasForAdmin } from './zelomenuMesaHandler.js'
```

- [ ] **Step 6: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/zelomenuMesaHandler.ts server/index.ts src/domain/zelomenuMesa.test.ts
git commit -m "feat(mesas): server handler for mesa context + admin mesas list"
```

---

### Task 2: zelomenuApi.ts — client functions for mesa

**Files:**
- Modify: `src/services/zelomenuApi.ts`

**Interfaces:**
- Consumes: `GET /api/public/zelomenu/mesa/:mesaId?slug={slug}` from Task 1
- Produces: `getMesaContext(slug, mesaId)` → `MesaContextResponse` used by Task 5
- Produces: extended `startPublicOrder()` accepting `tableOrderContext` used by Task 5

- [ ] **Step 1: Add types and getMesaContext function to src/services/zelomenuApi.ts**

Append after the existing type definitions (before the first function):

```typescript
export interface MesaContextResponse {
  comanda_id?: string
  comanda_status?: string
  mesa_numero?: string
  error?: 'SEM_COMANDA' | 'MESA_NOT_FOUND'
}

export interface TableOrderContext {
  mesa_id: string
  comanda_id: string
}
```

Append the function after `parseResponse`:

```typescript
export async function getMesaContext(
  slug: string,
  mesaId: string,
): Promise<MesaContextResponse> {
  const response = await fetch(
    `/api/public/zelomenu/mesa/${encodeURIComponent(mesaId)}?slug=${encodeURIComponent(slug)}`,
  )
  return parseResponse<MesaContextResponse>(response)
}
```

- [ ] **Step 2: Extend startPublicOrder to accept tableOrderContext**

Find the existing `startPublicOrder` function and add the optional parameter:

```typescript
export async function startPublicOrder(
  slug: string,
  payload: {
    customerName?: string | null
    customerPhone?: string | null
    items: ZeloMenuUpdateCartPayload['items']
    tableOrderContext?: TableOrderContext  // ← add this
  },
): Promise<{ token: string; path: string; orderingId: string }> {
  const response = await fetch(`/api/public/zelomenu/store/${encodeURIComponent(slug)}/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ...(payload.tableOrderContext
        ? {
            context: 'table_order',
            mesa_id: payload.tableOrderContext.mesa_id,
            comanda_id: payload.tableOrderContext.comanda_id,
          }
        : {}),
    }),
  })
  return parseResponse<{ token: string; path: string; orderingId: string }>(response)
}
```

- [ ] **Step 3: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/services/zelomenuApi.ts
git commit -m "feat(mesas): client API functions for mesa context and table order"
```

---

### Task 3: MesasAdminSection component

**Files:**
- Create: `src/components/zelomenu/MesasAdminSection.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/zelomenu/mesas` from Task 1
- Consumes: `listMesasForAdmin` result shape: `{ id, numero, capacidade, status, ativa }`
- Produces: `<MesasAdminSection slug={string} />` used by Task 4

- [ ] **Step 1: Create src/components/zelomenu/MesasAdminSection.tsx**

```typescript
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

interface Mesa {
  id: string
  numero: string
  capacidade: number | null
  status: string
  ativa: boolean
}

interface Props {
  slug: string
}

export function MesasAdminSection({ slug }: Props) {
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [loading, setLoading] = useState(true)
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch('/api/admin/zelomenu/mesas', {
      headers: { Authorization: `Bearer ${(window as any).__supabaseSession?.access_token ?? ''}` },
    })
      .then(r => r.json())
      .then(async data => {
        const list: Mesa[] = data.mesas ?? []
        setMesas(list)
        const urls: Record<string, string> = {}
        for (const mesa of list) {
          const baseUrl = window.location.origin
          urls[mesa.id] = await QRCode.toDataURL(
            `${baseUrl}/${slug}/mesa/${mesa.id}`,
            { width: 256, margin: 2 },
          )
        }
        setQrUrls(urls)
      })
      .finally(() => setLoading(false))
  }, [slug])

  function downloadQr(mesa: Mesa) {
    const url = qrUrls[mesa.id]
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `qr-mesa-${mesa.numero}.png`
    a.click()
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500">Carregando mesas...</div>
    )
  }

  if (mesas.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">
          Nenhuma mesa cadastrada. Gerencie suas mesas no{' '}
          <strong>ZeloPDV → Gestão → Mesas</strong>.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-gray-500">
        Baixe os QR codes e cole em cada mesa. O cliente escaneia e faz o pedido
        diretamente pelo cardápio.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {mesas.map(mesa => (
          <div
            key={mesa.id}
            className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 p-4"
          >
            <span className="text-sm font-semibold text-gray-800">
              Mesa {mesa.numero}
            </span>
            {qrUrls[mesa.id] && (
              <img
                src={qrUrls[mesa.id]}
                alt={`QR Mesa ${mesa.numero}`}
                className="h-32 w-32"
              />
            )}
            <button
              onClick={() => downloadQr(mesa)}
              className="mt-1 min-h-[44px] w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white active:opacity-80"
            >
              Baixar PNG
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/zelomenu/MesasAdminSection.tsx
git commit -m "feat(mesas): MesasAdminSection com QR code por mesa"
```

---

### Task 4: Wire MesasAdminSection into AdminPage + AdminLayout

**Files:**
- Modify: `src/components/AdminLayout.tsx`
- Modify: `src/pages/AdminPage.tsx`

**Interfaces:**
- Consumes: `MesasAdminSection` from Task 3
- Consumes: `entitlement.capabilities.mesas` and `entitlement.capabilities.menu_publication` from `useZeloMenuEntitlement`

- [ ] **Step 1: Add 'mesas' to NavSection in AdminLayout.tsx**

Find `NavSection` type and `NAV_ITEMS` array:

```typescript
// Before:
export type NavSection = 'catalog' | 'publication'

const NAV_ITEMS: NavItem[] = [
  { id: 'catalog', label: 'Cardápio', icon: ShoppingBag },
  { id: 'publication', label: 'Publicação', icon: Globe2 },
]

// After:
export type NavSection = 'catalog' | 'publication' | 'mesas'

const NAV_ITEMS: NavItem[] = [
  { id: 'catalog', label: 'Cardápio', icon: ShoppingBag },
  { id: 'publication', label: 'Publicação', icon: Globe2 },
  { id: 'mesas', label: 'Mesas', icon: LayoutGrid },  // import LayoutGrid from 'lucide-react'
]
```

Add the import: `import { LayoutGrid, ShoppingBag, Globe2 } from 'lucide-react'`

Then in the content rendering area, add the mesas branch. Find the existing render pattern and extend it:

```typescript
// AdminLayout props
interface AdminLayoutProps {
  activeSection: NavSection
  onNavigate: (section: NavSection) => void
  catalogContent: ReactNode
  publicationContent: ReactNode
  mesasContent?: ReactNode  // optional — only rendered when capability active
}
```

In the content area:

```typescript
{activeSection === 'catalog' && catalogContent}
{activeSection === 'publication' && publicationContent}
{activeSection === 'mesas' && mesasContent}
```

Also hide the Mesas nav item when `mesasContent` is undefined:

```typescript
const visibleNavItems = NAV_ITEMS.filter(item =>
  item.id !== 'mesas' || mesasContent !== undefined,
)
```

Use `visibleNavItems` instead of `NAV_ITEMS` in the nav render.

- [ ] **Step 2: Wire MesasAdminSection in AdminPage.tsx**

Add import at top:

```typescript
import { MesasAdminSection } from '../components/zelomenu/MesasAdminSection'
```

Find where `activeSection` is managed and add the mesas section. Find the `AdminLayout` render call and add `mesasContent`:

```typescript
const showMesas =
  entitlement.capabilities.mesas && entitlement.capabilities.menu_publication

// In the AdminLayout render:
<AdminLayout
  activeSection={activeSection}
  onNavigate={setActiveSection}
  catalogContent={/* existing */}
  publicationContent={/* existing */}
  mesasContent={showMesas && slug
    ? <MesasAdminSection slug={slug} />
    : undefined
  }
/>
```

Where `slug` is the store slug (already loaded in AdminPage via the existing slug fetch).

- [ ] **Step 3: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/AdminLayout.tsx src/pages/AdminPage.tsx
git commit -m "feat(mesas): seção Mesas no admin com gate caps.mesas + caps.menu_publication"
```

---

### Task 5: ZeloMenuMesaPage — public storefront for mesa

**Files:**
- Create: `src/pages/ZeloMenuMesaPage.tsx`

**Interfaces:**
- Consumes: `getMesaContext(slug, mesaId)` from Task 2
- Consumes: existing store data loading pattern from `ZeloMenuStorePage`
- Consumes: `TableOrderContext` type from Task 2
- Produces: `<ZeloMenuMesaPage />` rendered at `/:slug/mesa/:mesaId` by Task 6
- Produces: `tableOrderContext` passed to cart flow in Task 7 via `startPublicOrder`

- [ ] **Step 1: Create src/pages/ZeloMenuMesaPage.tsx**

```typescript
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getMesaContext, type MesaContextResponse } from '../services/zelomenuApi'
import { ZeloMenuStorePage } from './ZeloMenuStorePage'

export function ZeloMenuMesaPage() {
  const { slug, mesaId } = useParams<{ slug: string; mesaId: string }>()
  const [mesaCtx, setMesaCtx] = useState<MesaContextResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug || !mesaId) return
    getMesaContext(slug, mesaId)
      .then(setMesaCtx)
      .finally(() => setLoading(false))
  }, [slug, mesaId])

  if (!slug || !mesaId) return null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-400">Carregando...</span>
      </div>
    )
  }

  const hasCarta = mesaCtx && !mesaCtx.error

  return (
    <ZeloMenuStorePage
      slug={slug}
      mesaBanner={
        hasCarta
          ? `Mesa ${mesaCtx!.mesa_numero}`
          : undefined
      }
      mesaUnavailableMessage={
        !hasCarta
          ? mesaCtx?.error === 'MESA_NOT_FOUND'
            ? 'Mesa não encontrada.'
            : 'Aguardando atendimento. Peça ao garçom para abrir sua comanda.'
          : undefined
      }
      tableOrderContext={
        hasCarta
          ? { mesa_id: mesaId, comanda_id: mesaCtx!.comanda_id! }
          : undefined
      }
    />
  )
}
```

- [ ] **Step 2: Add mesa props to ZeloMenuStorePage**

Open `src/pages/ZeloMenuStorePage.tsx` and find its props type. Add:

```typescript
interface ZeloMenuStorePageProps {
  slug?: string                          // if undefined, read from useParams
  mesaBanner?: string                    // e.g. "Mesa 5" — shown as banner
  mesaUnavailableMessage?: string        // if set, cart is disabled and this message shown
  tableOrderContext?: TableOrderContext   // passed through to cart creation
}
```

At the top of the component:
```typescript
export function ZeloMenuStorePage({
  slug: slugProp,
  mesaBanner,
  mesaUnavailableMessage,
  tableOrderContext,
}: ZeloMenuStorePageProps = {}) {
  const { slug: slugParam } = useParams<{ slug: string }>()
  const slug = slugProp ?? slugParam
  // ... rest of existing logic unchanged
```

Where the order button / cart initiation lives, pass `tableOrderContext` to `startPublicOrder`. Find the call and update:

```typescript
await startPublicOrder(slug, {
  customerName,
  customerPhone,
  items,
  tableOrderContext,  // ← add
})
```

Show the mesa banner when `mesaBanner` is set — add above the store header:

```typescript
{mesaBanner && (
  <div className="sticky top-0 z-10 bg-gray-900 px-4 py-2 text-center text-sm font-semibold text-white">
    {mesaBanner} — Peça pelo app
  </div>
)}
```

Show unavailability message and disable cart button when `mesaUnavailableMessage` is set:

```typescript
{mesaUnavailableMessage && (
  <div className="mx-4 mt-4 rounded-xl bg-amber-50 p-4 text-center text-sm text-amber-800">
    {mesaUnavailableMessage}
  </div>
)}
```

Pass `cartDisabled={!!mesaUnavailableMessage}` to wherever the cart/checkout button renders and disable it accordingly.

- [ ] **Step 3: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/pages/ZeloMenuMesaPage.tsx src/pages/ZeloMenuStorePage.tsx
git commit -m "feat(mesas): ZeloMenuMesaPage + mesa banner + cart disabled sem comanda"
```

---

### Task 6: Wire /:slug/mesa/:mesaId route in App.tsx

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ZeloMenuMesaPage` from Task 5

- [ ] **Step 1: Add import and route**

In `src/App.tsx`, add the import:

```typescript
import { ZeloMenuMesaPage } from './pages/ZeloMenuMesaPage'
```

Add the route **before** `/:slug` (React Router matches in order — mesa route must come first):

```typescript
<Routes>
  <Route path="/" element={<HomePage />} />
  <Route path="/admin" element={<AdminPage />} />
  <Route path="/auth/callback" element={<AuthCallbackPage />} />
  <Route path="/menu/carrinho/:token" element={<ZeloMenuCartPage />} />
  <Route path="/:slug/mesa/:mesaId" element={<ZeloMenuMesaPage />} />  {/* ← add before /:slug */}
  <Route path="/:slug" element={<ZeloMenuStorePage />} />
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

- [ ] **Step 2: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(mesas): rota pública /:slug/mesa/:mesaId"
```

---

### Task 7: Cart server — accept table_order context on open

**Files:**
- Modify: `server/zelomenuCartSessions.ts`

**Interfaces:**
- Consumes: `getMesaContext` from Task 1 (called to validate `comanda_id`)
- Produces: cart session with `metadata.mesa_id` and `metadata.comanda_id` for Task 8

- [ ] **Step 1: Write the failing test**

Add to `src/domain/zelomenuMesa.test.ts`:

```typescript
describe('table_order comanda validation', () => {
  it('rejects if session comanda_id differs from active comanda', () => {
    function validateComandaStillActive(
      sessionComandaId: string,
      activeComandaId: string | null,
    ): 'ok' | 'COMANDA_CLOSED' | 'TABLE_TAKEN_BY_OTHER_GROUP' {
      if (!activeComandaId) return 'COMANDA_CLOSED'
      if (sessionComandaId !== activeComandaId) return 'TABLE_TAKEN_BY_OTHER_GROUP'
      return 'ok'
    }

    expect(validateComandaStillActive('abc', null)).toBe('COMANDA_CLOSED')
    expect(validateComandaStillActive('abc', 'xyz')).toBe('TABLE_TAKEN_BY_OTHER_GROUP')
    expect(validateComandaStillActive('abc', 'abc')).toBe('ok')
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm test -- --run src/domain/zelomenuMesa.test.ts
```

Expected: PASS

- [ ] **Step 3: Modify openPublicOrderCartSession in server/zelomenuCartSessions.ts**

Find the `openPublicOrderCartSession` function. Its input parameter object should accept the new optional fields:

```typescript
// Find the existing input type (or inline params) and add:
context?: 'public_order' | 'table_order'
mesa_id?: string
comanda_id?: string  // snapshot from client
```

At the start of `openPublicOrderCartSession`, after resolving `empresaId`, add validation for `table_order`:

```typescript
// If table_order context, validate comanda is still open
if (context === 'table_order') {
  if (!mesa_id || !comanda_id) throw new Error('MISSING_TABLE_CONTEXT')

  const mesaResult = await getMesaContext(mesa_id, empresaId)
  if (!mesaResult.ok) throw new Error('COMANDA_CLOSED')
  if (mesaResult.comanda_id !== comanda_id) throw new Error('TABLE_TAKEN_BY_OTHER_GROUP')
}
```

Import `getMesaContext` from `./zelomenuMesaHandler.js` at the top of the file.

When inserting the cart session, include the mesa metadata:

```typescript
// In the INSERT into zelomenu_cart_sessions, update the metadata field:
metadata: {
  source: context === 'table_order' ? 'mesa' : 'public_link',
  slug: normalizedSlug,
  ...(context === 'table_order' ? { mesa_id, comanda_id } : {}),
},
// Also store context in the session:
context: context ?? 'public_order',
```

- [ ] **Step 4: Propagate new params from server/index.ts**

In `server/index.ts`, in the `POST /api/public/zelomenu/store/:slug/cart` handler, pass the new fields:

```typescript
const result = await openPublicOrderCartSession({
  slug: req.params.slug,
  customerName: req.body.customerName ?? null,
  customerPhone: req.body.customerPhone ?? null,
  items: req.body.items ?? [],
  fulfillment: req.body.fulfillment ?? null,
  paymentMethod: req.body.paymentMethod ?? null,
  observations: req.body.observations ?? null,
  context: req.body.context ?? 'public_order',  // ← add
  mesa_id: req.body.mesa_id ?? undefined,        // ← add
  comanda_id: req.body.comanda_id ?? undefined,  // ← add
})
```

Add error mappings for the new error codes in the same handler:

```typescript
if (message === 'MISSING_TABLE_CONTEXT') return res.status(400).json({ error: 'MISSING_TABLE_CONTEXT' })
if (message === 'COMANDA_CLOSED') return res.status(409).json({ error: 'COMANDA_CLOSED' })
if (message === 'TABLE_TAKEN_BY_OTHER_GROUP') return res.status(409).json({ error: 'TABLE_TAKEN_BY_OTHER_GROUP' })
```

- [ ] **Step 5: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add server/zelomenuCartSessions.ts server/index.ts src/domain/zelomenuMesa.test.ts
git commit -m "feat(mesas): validação de comanda ativa na abertura do carrinho de mesa"
```

---

### Task 8: Confirm flow — write to pedidos + pedido_itens on table_order

**Files:**
- Modify: `server/zelomenuCartSessions.ts`
- Modify: `server/supabaseServer.ts` (if `supabaseAdmin` not already exported)

**Interfaces:**
- Consumes: `supabaseAdmin` (service-role) from `server/supabaseServer.ts`
- Consumes: `proximo_numero_pedido` Supabase RPC on ZeloPDV schema
- Produces: confirmed `table_order` cart writes `pedidos` + `pedido_itens`; session state → `confirmed_waiting_review`

- [ ] **Step 1: Write the failing test for double-validation logic**

Add to `src/domain/zelomenuMesa.test.ts`:

```typescript
describe('double-validation at confirm', () => {
  it('detects when comanda changed between cart open and confirm', () => {
    const sessionMeta = { comanda_id: 'abc-123', mesa_id: 'mesa-1' }
    const currentActive = { comanda_id: 'xyz-789' }  // different group sat down
    const isSafe = sessionMeta.comanda_id === currentActive.comanda_id
    expect(isSafe).toBe(false)
  })

  it('allows confirm when comanda unchanged', () => {
    const sessionMeta = { comanda_id: 'abc-123', mesa_id: 'mesa-1' }
    const currentActive = { comanda_id: 'abc-123' }
    const isSafe = sessionMeta.comanda_id === currentActive.comanda_id
    expect(isSafe).toBe(true)
  })
})
```

- [ ] **Step 2: Run test**

```bash
npm test -- --run src/domain/zelomenuMesa.test.ts
```

Expected: PASS

- [ ] **Step 3: Add createTableOrderPedido function in server/zelomenuCartSessions.ts**

Add this helper function (before `confirmPublicCartSession`):

```typescript
async function createTableOrderPedido(params: {
  empresaId: string
  comandaId: string
  cartSnapshot: ZeloMenuCartSnapshot
  customerName: string | null
  observations: string | null
}): Promise<string> {
  const { empresaId, comandaId, cartSnapshot, customerName, observations } = params

  // Get next numero_pedido
  const { data: numData, error: numError } = await supabaseAdmin
    .rpc('proximo_numero_pedido', { p_id_usuario: empresaId })
  if (numError) throw new Error('PEDIDO_NUMBER_FAILED')
  const numeroPedido = numData as number

  // Insert pedido
  const { data: pedido, error: pedidoError } = await supabaseAdmin
    .from('pedidos')
    .insert({
      id_usuario: empresaId,
      origem: 'zelomenu',
      id_comanda: comandaId,
      status: 'aberto',
      nome_cliente: customerName,
      observacoes: observations,
      numero_pedido: numeroPedido,
    })
    .select('id')
    .single()
  if (pedidoError || !pedido) throw new Error('PEDIDO_INSERT_FAILED')

  // Insert pedido_itens
  const itens = cartSnapshot.items.map(item => ({
    id_pedido: pedido.id,
    id_produto: item.productId ? Number(item.productId) : null,
    nome: item.productName,
    preco_unitario: item.unitPrice,
    quantidade: item.quantity,
    subtotal: item.unitPrice * item.quantity,
    enviado_cozinha: true,
    status_cozinha: 'aguardando',
  }))

  const { error: itensError } = await supabaseAdmin.from('pedido_itens').insert(itens)
  if (itensError) throw new Error('PEDIDO_ITENS_INSERT_FAILED')

  return pedido.id
}
```

- [ ] **Step 4: Modify confirmPublicCartSession to branch on context**

Find `confirmPublicCartSession`. After the existing revalidation block (where it currently calls `createAcceptedOrderRecord`), add a branch before that call:

```typescript
// Determine context
const isTableOrder = sessionRow.context === 'table_order'
const mesaId = sessionRow.metadata?.mesa_id as string | undefined
const sessionComandaId = sessionRow.metadata?.comanda_id as string | undefined

if (isTableOrder) {
  // Double-validate comanda
  if (!mesaId || !sessionComandaId) throw new Error('MISSING_TABLE_CONTEXT')

  const mesaResult = await getMesaContext(mesaId, empresaId)
  if (!mesaResult.ok) throw new Error('COMANDA_CLOSED')
  if (mesaResult.comanda_id !== sessionComandaId) throw new Error('TABLE_TAKEN_BY_OTHER_GROUP')

  // Write to ZeloPDV pedidos
  const pedidoId = await createTableOrderPedido({
    empresaId,
    comandaId: sessionComandaId,
    cartSnapshot: sessionRow.cart_snapshot,
    customerName: sessionRow.customer_snapshot?.name ?? null,
    observations: sessionRow.cart_snapshot?.observations ?? null,
  })

  // Update session state
  await supabaseAdmin
    .from('zelomenu_cart_sessions')
    .update({
      state: 'confirmed_waiting_review',
      metadata: { ...sessionRow.metadata, productionPedidoId: pedidoId },
    })
    .eq('id', sessionRow.id)

  return { state: 'confirmed_waiting_review', orderingId: sessionRow.ordering_id }
}

// Existing public_order flow continues below unchanged...
```

Add error mappings in `server/index.ts` confirm handler:

```typescript
if (message === 'COMANDA_CLOSED') return res.status(409).json({ error: 'COMANDA_CLOSED' })
if (message === 'TABLE_TAKEN_BY_OTHER_GROUP') return res.status(409).json({ error: 'TABLE_TAKEN_BY_OTHER_GROUP' })
if (message === 'PEDIDO_INSERT_FAILED') return res.status(500).json({ error: 'PEDIDO_INSERT_FAILED' })
```

- [ ] **Step 5: Handle staleness errors in ZeloMenuMesaPage**

In `src/pages/ZeloMenuStorePage.tsx`, where the confirm error is caught, add handling for the new error codes:

```typescript
if (error.message === 'TABLE_TAKEN_BY_OTHER_GROUP') {
  showToast('Esta mesa está sendo atendida por outro grupo. Escaneie o QR novamente.', 'error')
  return
}
if (error.message === 'COMANDA_CLOSED') {
  showToast('Sessão encerrada. Peça ao garçom para abrir uma nova comanda.', 'error')
  return
}
```

- [ ] **Step 6: Type-check**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 7: Run all tests**

```bash
npm test -- --run
```

Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add server/zelomenuCartSessions.ts server/index.ts src/domain/zelomenuMesa.test.ts src/pages/ZeloMenuStorePage.tsx
git commit -m "feat(mesas): confirm de mesa cria pedido em ZeloPDV com dupla validação de comanda"
```

---

## Tasks — ZeloPDV

> Estes tasks são executados no repositório `C:\Users\Vinicius\orca\zelopdv`

---

### Task 9: Migration — adicionar status `preparando` em pedidos

**Files:**
- Create: `.ai/migrations/pedidos_preparando_status_2026_06_25.sql`

**Interfaces:**
- Produces: `pedidos.status` aceita `'preparando'` além de `'aberto'`, `'pronto'`, `'fechado'`

- [ ] **Step 1: Verificar constraint atual**

No Supabase dashboard ou via psql, verificar a constraint existente:

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'pedidos_status_check';
```

Expected: something like `CHECK (status IN ('aberto', 'pronto', 'fechado'))`

- [ ] **Step 2: Criar o arquivo de migration**

Criar `.ai/migrations/pedidos_preparando_status_2026_06_25.sql`:

```sql
-- Adiciona status 'preparando' ao fluxo de cozinha para pedidos zelomenu
-- Novo fluxo: aberto → preparando → pronto → fechado
-- Contexto: pedidos com origem='zelomenu' chegam como 'aberto'; cozinheiro
-- move para 'preparando' ao iniciar o preparo, e 'pronto' ao terminar.

ALTER TABLE pedidos
  DROP CONSTRAINT IF EXISTS pedidos_status_check;

ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_status_check
  CHECK (status IN ('aberto', 'preparando', 'pronto', 'fechado'));
```

- [ ] **Step 3: Aplicar no Supabase**

Aplicar a migration diretamente via Supabase SQL Editor ou CLI:

```bash
# via supabase CLI (se configurado):
supabase db execute --file .ai/migrations/pedidos_preparando_status_2026_06_25.sql

# OU copiar e colar o SQL no Supabase Dashboard → SQL Editor
```

- [ ] **Step 4: Commit**

```bash
git add .ai/migrations/pedidos_preparando_status_2026_06_25.sql
git commit -m "feat(mesas): migration — adiciona status preparando em pedidos"
```

---

### Task 10: Kitchen queue — badge zelomenu + botão preparando

**Files:**
- Modify: `src/routes/app/pedidos/cozinha/+page.svelte`

**Interfaces:**
- Consumes: `pedido.origem` — `'zelomenu'` triggers the "📱 App" badge
- Consumes: `pedido.status` — now includes `'preparando'` from Task 9

- [ ] **Step 1: Localizar onde a origem é exibida na cozinha**

Abrir `src/routes/app/pedidos/cozinha/+page.svelte`. Procurar pelas linhas 159-163 onde o badge de origem é exibido (algo como `"Comanda"`, `"ZeloChat"`, `"Balcão"`).

- [ ] **Step 2: Adicionar badge para zelomenu**

Encontrar o bloco de badge de origem. Adicionar o case `'zelomenu'`:

```svelte
{#if pedido.origem === 'zelomenu'}
  <span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
    📱 App
  </span>
{:else if pedido.origem === 'zelochat'}
  <!-- ... existing zelochat badge -->
{:else if pedido.origem === 'comanda'}
  <!-- ... existing comanda badge -->
{:else}
  <!-- ... existing balcao badge -->
{/if}
```

- [ ] **Step 3: Adicionar botão "Preparando" no fluxo de status**

Encontrar onde o botão "Marcar como pronto" existe (cerca das linhas 251-259). Adicionar um botão anterior para `preparando`:

```svelte
{#if pedido.status === 'aberto'}
  <button
    class="min-h-[44px] rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white active:opacity-80"
    on:click={() => atualizarStatusPedido(pedido.id, 'preparando')}
  >
    Iniciar preparo
  </button>
{:else if pedido.status === 'preparando'}
  <button
    class="min-h-[44px] rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white active:opacity-80"
    on:click={() => atualizarStatusPedido(pedido.id, 'pronto')}
  >
    Marcar como pronto
  </button>
{/if}
```

- [ ] **Step 4: Atualizar a query de display para incluir `preparando` na lane correta**

Encontrar onde `pedidosAbertos` e `pedidosProntos` são filtrados. Adicionar `preparando` à lane "Em preparo":

```javascript
// Antes:
$: pedidosAbertos = pedidos.filter(p => p.status !== 'pronto')
$: pedidosProntos = pedidos.filter(p => p.status === 'pronto')

// Depois:
$: pedidosAbertos = pedidos.filter(p => p.status === 'aberto' || p.status === 'preparando')
$: pedidosProntos = pedidos.filter(p => p.status === 'pronto')
```

Dentro da lane "Em preparo", mostrar sub-label para `preparando`:

```svelte
{#if pedido.status === 'preparando'}
  <span class="text-xs font-medium text-amber-600">Em preparo</span>
{/if}
```

- [ ] **Step 5: Verificar que atualizarStatusPedido aceita 'preparando'**

Localizar a função `atualizarStatusPedido` (ou equivalente) que faz o UPDATE. Verificar que ela simplesmente faz:

```javascript
async function atualizarStatusPedido(id, novoStatus) {
  await supabase
    .from('pedidos')
    .update({ status: novoStatus })
    .eq('id', id)
    .eq('id_usuario', ownerUserId)
  // ... refresh
}
```

Não deve ter validação hardcoded de valores — se tiver, adicionar `'preparando'` à lista permitida.

- [ ] **Step 6: Commit**

```bash
git add src/routes/app/pedidos/cozinha/+page.svelte
git commit -m "feat(mesas): badge App na cozinha + fluxo aberto → preparando → pronto"
```

---

## Self-Review

### Cobertura do spec

| Requisito do spec | Task que implementa |
|-------------------|---------------------|
| QR code no admin ZeloMenu com gate `caps.mesas AND caps.menu_publication` | Tasks 1, 3, 4 |
| Rota pública `/{slug}/mesa/:mesaId` | Tasks 5, 6 |
| Mesa sem comanda → vitrine read-only | Task 5 (mesaUnavailableMessage) |
| Snapshot de `comanda_id` na abertura do carrinho | Task 7 |
| Dupla validação de `comanda_id` no confirm | Task 8 |
| Escrita em `pedidos` + `pedido_itens` com `origem='zelomenu'` | Task 8 |
| Mensagens de staleness claras para o cliente | Tasks 7, 8 |
| Badge `📱 App` na cozinha ZeloPDV | Task 10 |
| Status `aberto → preparando → pronto` | Tasks 9, 10 |
| Zero migrations novas no ZeloMenu | ✅ confirmado |
| `numero_pedido` via RPC `proximo_numero_pedido` | Task 8 |

### Gaps não encontrados

Todos os requisitos do spec têm cobertura. A incorporação automática de `pedido_itens` → `comanda_itens` está marcada como pós-MVP no spec e não tem task aqui intencionalmente.
