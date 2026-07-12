import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPublicStoreBySlug, openPublicOrderCartSession, getPublicCartSession, updatePublicCartSession, confirmPublicCartSession, setEmpresaZeloMenuSlug, getEmpresaZeloMenuSlug, getZeloMenuStoreSettings, updateZeloMenuStoreSettings, resolveEmpresaIdBySlug } from './zelomenuCartSessions.js';
import { requireEmpresaId, getEmpresaUserId } from './supabaseServer.js';
import { getMesaContext, listMesasForAdmin } from './zelomenuMesaHandler.js';
import type { Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT) || 3101;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const requestId = req.header('x-request-id')?.slice(0, 100) || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// Trust proxy headers when behind a reverse proxy
app.set('trust proxy', 1);

// ─── Public store by slug ─────────────────────────────────────────────────────

app.get('/api/public/zelomenu/store/:slug', async (req, res) => {
  try {
    const result = await getPublicStoreBySlug(req.params.slug);
    if (!result) return res.status(404).json({ error: 'STORE_NOT_FOUND' });
    res.json(result);
  } catch (error) {
    console.error('[ZeloMenu] getPublicStoreBySlug error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Start public order (open cart) ───────────────────────────────────────────

app.post('/api/public/zelomenu/store/:slug/cart', async (req, res) => {
  try {
    const result = await openPublicOrderCartSession({
      slug: req.params.slug,
      customerName: req.body.customerName ?? null,
      customerPhone: req.body.customerPhone ?? null,
      items: req.body.items ?? [],
      fulfillment: req.body.fulfillment ?? null,
      paymentMethod: req.body.paymentMethod ?? null,
      observations: req.body.observations ?? null,
      context: req.body.context ?? 'public_order',
      mesa_id: req.body.mesa_id ?? undefined,
      comanda_id: req.body.comanda_id ?? undefined,
    });
    if (!result) return res.status(404).json({ error: 'STORE_NOT_FOUND' });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ZeloMenu] openPublicOrderCartSession error:', error);
    if (message === 'EMPTY_CART') return res.status(400).json({ error: 'EMPTY_CART' });
    if (message === 'PRODUCT_NOT_FOUND') return res.status(400).json({ error: 'PRODUCT_NOT_FOUND' });
    if (message === 'PRODUCT_UNAVAILABLE') return res.status(400).json({ error: 'PRODUCT_UNAVAILABLE' });
    if (message === 'PRODUCT_STOCK_EXCEEDED') return res.status(400).json({ error: 'PRODUCT_STOCK_EXCEEDED' });
    if (message === 'DELIVERY_DISABLED') return res.status(400).json({ error: 'DELIVERY_DISABLED' });
    if (message.startsWith('MODIFIER_INVALID:')) return res.status(400).json({ error: 'MODIFIER_INVALID', detail: message.slice('MODIFIER_INVALID:'.length) });
    if (message === 'MISSING_TABLE_CONTEXT') return res.status(400).json({ error: 'MISSING_TABLE_CONTEXT' });
    if (message === 'COMANDA_CLOSED') return res.status(409).json({ error: 'COMANDA_CLOSED' });
    if (message === 'TABLE_TAKEN_BY_OTHER_GROUP') return res.status(409).json({ error: 'TABLE_TAKEN_BY_OTHER_GROUP' });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Get public cart session ──────────────────────────────────────────────────

app.get('/api/public/zelomenu/cart/:token', async (req, res) => {
  try {
    const result = await getPublicCartSession(req.params.token);
    if (!result) return res.status(404).json({ error: 'CART_NOT_FOUND' });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'CART_TOKEN_EXPIRED') return res.status(410).json({ error: 'CART_TOKEN_EXPIRED', requestId: res.locals.requestId });
    console.error('[ZeloMenu] getPublicCartSession error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Update public cart session ───────────────────────────────────────────────

app.patch('/api/public/zelomenu/cart/:token', async (req, res) => {
  try {
    const result = await updatePublicCartSession(req.params.token, req.body);
    if (!result) return res.status(404).json({ error: 'CART_NOT_FOUND' });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ZeloMenu] updatePublicCartSession error:', error);
    if (message === 'STALE_CART_TOKEN') return res.status(409).json({ error: 'STALE_CART_TOKEN', requestId: res.locals.requestId });
    if (message === 'CART_TOKEN_EXPIRED') return res.status(410).json({ error: 'CART_TOKEN_EXPIRED', requestId: res.locals.requestId });
    if (message === 'REVISION_CONFLICT') return res.status(409).json({ error: 'REVISION_CONFLICT', detail: 'O carrinho foi alterado em outra aba. Revise os dados atualizados.', requestId: res.locals.requestId });
    if (message === 'CART_ALREADY_CONFIRMED') return res.status(409).json({ error: 'CART_ALREADY_CONFIRMED' });
    if (message === 'PRODUCT_NOT_FOUND') return res.status(400).json({ error: 'PRODUCT_NOT_FOUND' });
    if (message === 'PRODUCT_UNAVAILABLE') return res.status(400).json({ error: 'PRODUCT_UNAVAILABLE' });
    if (message === 'PRODUCT_STOCK_EXCEEDED') return res.status(400).json({ error: 'PRODUCT_STOCK_EXCEEDED' });
    if (message === 'DELIVERY_DISABLED') return res.status(400).json({ error: 'DELIVERY_DISABLED' });
    if (message === 'INVALID_QUANTITY' || message === 'CART_LINE_LIMIT_EXCEEDED' || message === 'ORDER_TOTAL_LIMIT_EXCEEDED') return res.status(400).json({ error: message, requestId: res.locals.requestId });
    if (message.startsWith('MODIFIER_INVALID:')) return res.status(400).json({ error: 'MODIFIER_INVALID', detail: message.slice('MODIFIER_INVALID:'.length) });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Confirm public cart session ──────────────────────────────────────────────

app.post('/api/public/zelomenu/cart/:token/confirm', async (req, res) => {
  try {
    const result = await confirmPublicCartSession(req.params.token, req.body.expectedRevision, req.body.idempotencyKey);
    if (!result) return res.status(404).json({ error: 'CART_NOT_FOUND' });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ZeloMenu] confirmPublicCartSession error:', error);
    if (message === 'STALE_CART_TOKEN') return res.status(409).json({ error: 'STALE_CART_TOKEN' });
    if (message === 'CART_ALREADY_CLOSED') return res.status(409).json({ error: 'CART_ALREADY_CLOSED' });
    if (message === 'REVISION_CONFLICT') return res.status(409).json({ error: 'REVISION_CONFLICT', requestId: res.locals.requestId });
    if (message === 'IDEMPOTENCY_KEY_REQUIRED') return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED', requestId: res.locals.requestId });
    if (message === 'TABLE_SESSION_EXPIRED') return res.status(410).json({ error: 'TABLE_SESSION_EXPIRED', requestId: res.locals.requestId });
    if (message === 'ORDER_MATERIALIZATION_FAILED') return res.status(500).json({ error: 'ORDER_MATERIALIZATION_FAILED', requestId: res.locals.requestId });
    if (message === 'CUSTOMER_DETAILS_REQUIRED') return res.status(400).json({ error: 'CUSTOMER_DETAILS_REQUIRED' });
    if (message === 'COMANDA_CLOSED') return res.status(409).json({ error: 'COMANDA_CLOSED' });
    if (message === 'TABLE_TAKEN_BY_OTHER_GROUP') return res.status(409).json({ error: 'TABLE_TAKEN_BY_OTHER_GROUP' });
    if (message === 'PEDIDO_INSERT_FAILED') return res.status(500).json({ error: 'PEDIDO_INSERT_FAILED' });
    if (message.startsWith('STORE_CLOSED_ASAP:')) return res.status(400).json({ error: 'STORE_CLOSED_ASAP', detail: message.slice('STORE_CLOSED_ASAP:'.length) });
    if (message.startsWith('PICKUP_OUTSIDE_HOURS:')) return res.status(400).json({ error: 'PICKUP_OUTSIDE_HOURS', detail: message.slice('PICKUP_OUTSIDE_HOURS:'.length) });
    if (message.startsWith('PICKUP_CLOSED_DAY:')) return res.status(400).json({ error: 'PICKUP_CLOSED_DAY', detail: message.slice('PICKUP_CLOSED_DAY:'.length) });
    if (message.startsWith('PICKUP_TIME_INVALID:')) return res.status(400).json({ error: 'PICKUP_TIME_INVALID', detail: message.slice('PICKUP_TIME_INVALID:'.length) });
    if (message.startsWith('PICKUP_IN_PAST:')) return res.status(400).json({ error: 'PICKUP_IN_PAST', detail: message.slice('PICKUP_IN_PAST:'.length) });
    // Fallback genérico — nunca expõe detalhes internos
    console.error('[ZeloMenu] confirmPublicCartSession unhandled error:', message);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      detail: 'Ocorreu um erro inesperado. Tente novamente mais tarde.',
    });
  }
});

// ─── Admin error helper ───────────────────────────────────────────────────────

function sendAdminError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[ZeloMenu] admin error:', error);
  if (message === 'UNAUTHORIZED' || message === 'EMPRESA_NOT_FOUND') return void res.status(401).json({ error: message });
  if (message === 'INVALID_SLUG') return void res.status(400).json({ error: 'INVALID_SLUG' });
  if (message === 'RESERVED_SLUG') return void res.status(400).json({ error: 'RESERVED_SLUG' });
  if (message === 'SLUG_TAKEN') return void res.status(409).json({ error: 'SLUG_TAKEN' });
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// ─── Slug management (admin, Bearer-authed) ────────────────────────────────────

app.get('/api/admin/zelomenu/slug', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const slug = await getEmpresaZeloMenuSlug(empresaId);
    res.json({ slug });
  } catch (error) {
    sendAdminError(res, error);
  }
});

app.put('/api/admin/zelomenu/slug', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const slug = await setEmpresaZeloMenuSlug(empresaId, String(req.body?.slug ?? ''));
    res.json({ slug });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// ─── Store settings (admin, Bearer-authed) ─────────────────────────────────────

app.get('/api/admin/zelomenu/settings', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const settings = await getZeloMenuStoreSettings(empresaId);
    res.json(settings);
  } catch (error) {
    sendAdminError(res, error);
  }
});

app.patch('/api/admin/zelomenu/settings', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { welcomeText, featuredEnabled, featuredProductIds, categoryOrder } = req.body ?? {};
    await updateZeloMenuStoreSettings(empresaId, {
      ...(welcomeText !== undefined && { welcomeText: typeof welcomeText === 'string' ? welcomeText.slice(0, 500) : null }),
      ...(featuredEnabled !== undefined && { featuredEnabled: Boolean(featuredEnabled) }),
      ...(Array.isArray(featuredProductIds) && { featuredProductIds: featuredProductIds.map(Number).filter(Boolean) }),
      ...(Array.isArray(categoryOrder) && { categoryOrder: categoryOrder.map(String) }),
    });
    res.json({ ok: true });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// ─── AI welcome-text generation (admin, Bearer-authed) ─────────────────────────

app.post('/api/admin/zelomenu/welcome', async (req, res) => {
  try {
    await requireEmpresaId(req);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'AI_UNAVAILABLE' });

    const companyName = typeof req.body?.companyName === 'string' ? req.body.companyName : '';
    const companySpecialty = typeof req.body?.companySpecialty === 'string' ? req.body.companySpecialty : '';
    const categories = Array.isArray(req.body?.categories) ? (req.body.categories as unknown[]).map(String) : [];
    const catList = categories.slice(0, 8).join(', ');

    const prompt = `Escreva um texto de boas-vindas para o cardápio digital da loja "${companyName}"${companySpecialty ? ` (${companySpecialty})` : ''}. Categorias do cardápio: ${catList || 'variadas'}.\n\nRegras: máximo 2 a 3 linhas, tom acolhedor e animado, sem usar emojis, em português brasileiro. Retorne apenas o texto, sem aspas ou explicações.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      console.error('[ZeloMenu] OpenAI welcome generation failed:', response.status, await response.text().catch(() => ''));
      return res.status(503).json({ error: 'AI_UNAVAILABLE' });
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    res.json({ text });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// ─── AI product description generation (admin, Bearer-authed) ───────────────

app.post('/api/admin/zelomenu/product-description', async (req, res) => {
  try {
    await requireEmpresaId(req);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'AI_UNAVAILABLE' });

    const productName = typeof req.body?.productName === 'string' ? req.body.productName.trim() : '';
    if (!productName) return res.status(400).json({ error: 'Nome do produto é obrigatório.' });

    const prompt = `Escreva uma descrição curta e atraente para o produto "${productName}" de um cardápio digital de restaurante.\n\nRegras: máximo 2 frases, tom apetitoso e direto, sem emojis, em português brasileiro. Retorne apenas o texto, sem aspas ou explicações.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      console.error('[ZeloMenu] OpenAI product description generation failed:', response.status, await response.text().catch(() => ''));
      return res.status(503).json({ error: 'AI_UNAVAILABLE' });
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = (data.choices?.[0]?.message?.content ?? '').trim();
    res.json({ text });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// ─── Mesa public route ────────────────────────────────────────────────────────

app.get('/api/public/zelomenu/mesa/:mesaId', async (req, res) => {
  try {
    const slug = req.query.slug as string | undefined
    if (!slug) return res.status(400).json({ error: 'MISSING_SLUG' })
    const empresaId = await resolveEmpresaIdBySlug(slug)
    if (!empresaId) return res.status(404).json({ error: 'STORE_NOT_FOUND' })
    const ownerUserId = await getEmpresaUserId(empresaId)
    if (!ownerUserId) return res.status(404).json({ error: 'STORE_NOT_FOUND' })
    const result = await getMesaContext(req.params.mesaId, ownerUserId)
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

// ─── Mesas admin route ────────────────────────────────────────────────────────

app.get('/api/admin/zelomenu/mesas', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req)
    const ownerUserId = await getEmpresaUserId(empresaId)
    if (!ownerUserId) throw new Error('EMPRESA_NOT_FOUND')
    const mesas = await listMesasForAdmin(ownerUserId)
    res.json({ mesas })
  } catch (error) {
    sendAdminError(res, error)
  }
})

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Serve built frontend in production ──────────────────────────────────────

const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Inject runtime env vars into the HTML so the frontend doesn't depend on
// build-time --build-arg. The server reads them from process.env (set via
// Dokploy runtime env or VPS .env file).
const runtimeEnv = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? '',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
};
const envScript = `<script>window.__ENV__ = ${JSON.stringify(runtimeEnv)};</script>`;

let cachedHtml: string | null = null;

function getIndexHtml(): string {
  if (cachedHtml) return cachedHtml;
  const html = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
  cachedHtml = html.replace('</head>', `${envScript}\n  </head>`);
  return cachedHtml;
}

// SPA fallback — any non-API request returns index.html with runtime env
app.get('*', (_req, res) => {
  res.type('html').send(getIndexHtml());
});

app.listen(PORT, () => {
  console.log(`[ZeloMenu] Server listening on port ${PORT}`);
});
