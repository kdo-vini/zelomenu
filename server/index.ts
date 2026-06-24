import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublicStoreBySlug, openPublicOrderCartSession, getPublicCartSession, updatePublicCartSession, confirmPublicCartSession, setEmpresaZeloMenuSlug, getEmpresaZeloMenuSlug } from './zelomenuCartSessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT) || 3101;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
    if (message === 'STALE_CART_TOKEN') return res.status(409).json({ error: 'STALE_CART_TOKEN' });
    if (message === 'CART_ALREADY_CONFIRMED') return res.status(409).json({ error: 'CART_ALREADY_CONFIRMED' });
    if (message === 'PRODUCT_NOT_FOUND') return res.status(400).json({ error: 'PRODUCT_NOT_FOUND' });
    if (message === 'PRODUCT_UNAVAILABLE') return res.status(400).json({ error: 'PRODUCT_UNAVAILABLE' });
    if (message === 'PRODUCT_STOCK_EXCEEDED') return res.status(400).json({ error: 'PRODUCT_STOCK_EXCEEDED' });
    if (message === 'DELIVERY_DISABLED') return res.status(400).json({ error: 'DELIVERY_DISABLED' });
    if (message.startsWith('MODIFIER_INVALID:')) return res.status(400).json({ error: 'MODIFIER_INVALID', detail: message.slice('MODIFIER_INVALID:'.length) });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Confirm public cart session ──────────────────────────────────────────────

app.post('/api/public/zelomenu/cart/:token/confirm', async (req, res) => {
  try {
    const result = await confirmPublicCartSession(req.params.token);
    if (!result) return res.status(404).json({ error: 'CART_NOT_FOUND' });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ZeloMenu] confirmPublicCartSession error:', error);
    if (message === 'STALE_CART_TOKEN') return res.status(409).json({ error: 'STALE_CART_TOKEN' });
    if (message === 'CART_ALREADY_CLOSED') return res.status(409).json({ error: 'CART_ALREADY_CLOSED' });
    if (message === 'CUSTOMER_DETAILS_REQUIRED') return res.status(400).json({ error: 'CUSTOMER_DETAILS_REQUIRED' });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Slug management (admin) ──────────────────────────────────────────────────

app.get('/api/admin/zelomenu/slug', async (req, res) => {
  try {
    const empresaId = req.query.empresaId as string;
    if (!empresaId) return res.status(400).json({ error: 'EMPRESA_ID_REQUIRED' });
    const slug = await getEmpresaZeloMenuSlug(empresaId);
    res.json({ slug });
  } catch (error) {
    console.error('[ZeloMenu] getEmpresaZeloMenuSlug error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.post('/api/admin/zelomenu/slug', async (req, res) => {
  try {
    const { empresaId, slug } = req.body;
    if (!empresaId || !slug) return res.status(400).json({ error: 'EMPRESA_ID_AND_SLUG_REQUIRED' });
    const result = await setEmpresaZeloMenuSlug(empresaId, slug);
    res.json({ slug: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ZeloMenu] setEmpresaZeloMenuSlug error:', error);
    if (message === 'INVALID_SLUG') return res.status(400).json({ error: 'INVALID_SLUG' });
    if (message === 'RESERVED_SLUG') return res.status(400).json({ error: 'RESERVED_SLUG' });
    if (message === 'SLUG_TAKEN') return res.status(409).json({ error: 'SLUG_TAKEN' });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Serve built frontend in production ──────────────────────────────────────

const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback — any non-API request returns index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[ZeloMenu] Server listening on port ${PORT}`);
});
