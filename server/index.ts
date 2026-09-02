import 'dotenv/config';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPublicStoreBySlug, openPublicOrderCartSession, getPublicCartSession, updatePublicCartSession, confirmPublicCartSession, setEmpresaZeloMenuSlug, getEmpresaZeloMenuSlug, getZeloMenuStoreSettings, updateZeloMenuStoreSettings, resolveEmpresaIdBySlug, resolvePublicOrderSubscription, getZeloMenuOperationalMetrics } from './zelomenuCartSessions.js';
import { requireEmpresaId, getEmpresaUserId } from './supabaseServer.js';
import { requireZeloMenuAccess } from './zelomenuAccess.js';
import { getMesaContext, listMesasForAdmin } from './zelomenuMesaHandler.js';
import { listZeloMenuCoupons, createZeloMenuCoupon, updateZeloMenuCoupon, deleteZeloMenuCoupon } from './zelomenuCoupons.js';
import { PIX_KEY_TYPES, type PixKeyType } from '../src/domain/pixBrCode.js';
import type { Response } from 'express';
import { expireStaleQuoteRequests, getDeliveryHealth, getStoreDeliveryAddress, listDeliveryRanges, lookupCepOnly, resolveDeliveryStoreGeocoding, getDeliveryStoreData, saveDeliverySettings, listPendingDeliveryQuoteRequests, getDeliveryQuoteRequestById, retryDeliveryQuoteRequest, resolveDeliveryQuoteRequest, cancelDeliveryQuoteRequest } from './zelomenuDeliveryService.js';
import { listBusinesses } from './zelomenuBusinessDirectory.js';
import { removePublicPushSubscription, savePublicPushSubscription, startOrderStatusPushDispatcher, type PublicPushSubscriptionPayload } from './zelomenuPushSubscriptions.js';
import { getVapidConfig } from './vapidConfig.js';
import { snapshot as metricsSnapshot } from './deliveryMetrics.js';
import { createInternalCatalogSearchHandler } from './internalCatalogSearch.js';
import { createInternalCatalogFailureLimiter, makeInternalCatalogRateLimitKey } from './internalCatalogRateLimit.js';
import { createInternalOrderingRouter } from './internalOrdering.js';
import { ConversationOrdering } from './supabaseConversationOrderingAdapter.js';
import type { DeliveryAddress } from '../src/domain/zelomenuDelivery.js';
import type { Request } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT) || 3101;
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const internalCatalogFailureLimiter = createInternalCatalogFailureLimiter();
const internalOrderingFailureLimiter = createInternalCatalogFailureLimiter();

app.use((req, res, next) => {
  const requestId = req.header('x-request-id')?.slice(0, 100) || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// This route-specific guard intentionally runs before JSON parsing. Invalid
// bodies and oversized requests must be counted without affecting other APIs.
app.use('/internal/catalog/search', internalCatalogFailureLimiter);
app.use('/internal/ordering', internalOrderingFailureLimiter);

// Production is same-origin by default. Separate frontend origins must be
// explicitly allowlisted instead of inheriting a wildcard CORS policy.
app.use(cors({ origin: corsOrigins.length > 0 ? corsOrigins : false }));
app.use(express.json({ limit: '1mb' }));
app.use((error: unknown, _req: Request, res: Response, next: (error: unknown) => void) => {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
  if (error instanceof SyntaxError && status === 400) {
    return res.status(400).json({ error: 'JSON_INVALIDO', detail: 'Envie dados em JSON válido.', requestId: res.locals.requestId });
  }
  if (status === 413) {
    return res.status(413).json({ error: 'PAYLOAD_MUITO_GRANDE', detail: 'Os dados enviados são grandes demais.', requestId: res.locals.requestId });
  }
  return next(error);
});

// Trust proxy headers when behind a reverse proxy
app.set('trust proxy', 1);

// ─── Rate limiters ───────────────────────────────────────────────────────────

const generalPublicLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', detail: 'Muitas requisições. Tente novamente em instantes.' },
});

const cartTokenLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.params.token || ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown'),
  message: { error: 'TOO_MANY_REQUESTS', detail: 'Muitas requisições para este carrinho. Tente novamente em instantes.' },
});

const confirmLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', detail: 'Muitas tentativas de confirmação. Tente novamente em instantes.' },
});

const cepLookupLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', detail: 'Muitas consultas de CEP. Tente novamente em instantes.' },
});

const internalCatalogSearchLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const empresaId = (req as Request & { internalCatalogEmpresaId?: string }).internalCatalogEmpresaId;
    return makeInternalCatalogRateLimitKey(empresaId ?? 'consulta-invalida', ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown'));
  },
  handler: (_req, res) => res.status(429).json({
    error: 'MUITAS_REQUISICOES',
    detail: 'Muitas consultas em pouco tempo. Tente novamente em instantes.',
    requestId: res.locals.requestId,
  }),
});

// ─── Internal catalog discovery (ZeloChat) ───────────────────────────────────

app.post('/internal/catalog/search', createInternalCatalogSearchHandler({ rateLimit: internalCatalogSearchLimiter }));

app.use('/internal/ordering', createInternalOrderingRouter(ConversationOrdering));

// ─── Public store by slug ─────────────────────────────────────────────────────

app.get('/api/public/zelomenu/store/:slug', generalPublicLimiter, async (req, res) => {
  try {
    const result = await getPublicStoreBySlug(req.params.slug);
    if (!result) return res.status(404).json({ error: 'STORE_NOT_FOUND' });
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    res.json(result);
  } catch (error) {
    console.error('[ZeloMenu] getPublicStoreBySlug error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Start public order (open cart) ───────────────────────────────────────────

app.post('/api/public/zelomenu/store/:slug/cart', generalPublicLimiter, async (req, res) => {
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
    if (message === 'PRODUCT_STOCK_EXCEEDED' || message.startsWith('PRODUCT_STOCK_EXCEEDED:')) return res.status(400).json({ error: 'PRODUCT_STOCK_EXCEEDED' });
    if (message === 'DELIVERY_DISABLED') return res.status(400).json({ error: 'DELIVERY_DISABLED' });
    if (message === 'MODIFIER_QUANTITY_INVALID') return res.status(400).json({ error: 'MODIFIER_QUANTITY_INVALID', detail: 'A quantidade de complemento precisa ser um número inteiro positivo.' });
    if (message.startsWith('MODIFIER_INVALID:')) return res.status(400).json({ error: 'MODIFIER_INVALID', detail: message.slice('MODIFIER_INVALID:'.length) });
    if (message === 'MISSING_TABLE_CONTEXT') return res.status(400).json({ error: 'MISSING_TABLE_CONTEXT' });
    if (message === 'COMANDA_CLOSED') return res.status(409).json({ error: 'COMANDA_CLOSED' });
    if (message === 'TABLE_TAKEN_BY_OTHER_GROUP') return res.status(409).json({ error: 'TABLE_TAKEN_BY_OTHER_GROUP' });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Get public cart session ──────────────────────────────────────────────────

app.get('/api/public/zelomenu/cart/:token', cartTokenLimiter, async (req, res) => {
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

app.patch('/api/public/zelomenu/cart/:token', cartTokenLimiter, async (req, res) => {
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
    if (message === 'PRODUCT_STOCK_EXCEEDED' || message.startsWith('PRODUCT_STOCK_EXCEEDED:')) return res.status(400).json({ error: 'PRODUCT_STOCK_EXCEEDED' });
    if (message === 'DELIVERY_DISABLED') return res.status(400).json({ error: 'DELIVERY_DISABLED' });
    if (message === 'INVALID_QUANTITY' || message === 'CART_LINE_LIMIT_EXCEEDED' || message === 'ORDER_TOTAL_LIMIT_EXCEEDED') return res.status(400).json({ error: message, requestId: res.locals.requestId });
    if (message === 'MODIFIER_QUANTITY_INVALID') return res.status(400).json({ error: 'MODIFIER_QUANTITY_INVALID', detail: 'A quantidade de complemento precisa ser um número inteiro positivo.', requestId: res.locals.requestId });
    if (message.startsWith('MODIFIER_INVALID:')) return res.status(400).json({ error: 'MODIFIER_INVALID', detail: message.slice('MODIFIER_INVALID:'.length) });
    if (message === 'COUPON_INVALID') return res.status(400).json({ error: 'COUPON_INVALID' });
    if (message === 'COUPON_EXPIRED') return res.status(400).json({ error: 'COUPON_EXPIRED' });
    if (message === 'COUPON_MIN_NOT_MET') return res.status(400).json({ error: 'COUPON_MIN_NOT_MET' });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Confirm public cart session ──────────────────────────────────────────────

app.post('/api/public/zelomenu/cart/:token/confirm', confirmLimiter, async (req, res) => {
  try {
    const result = await confirmPublicCartSession(req.params.token, req.body.expectedRevision, req.body.idempotencyKey, typeof req.body.pushClientId === 'string' ? req.body.pushClientId.slice(0, 120) : undefined);
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
    if (message.startsWith('SCHEDULING_DISABLED:')) return res.status(400).json({ error: 'SCHEDULING_DISABLED', detail: message.slice('SCHEDULING_DISABLED:'.length) });
    if (message.startsWith('PICKUP_LEAD_TIME:')) return res.status(400).json({ error: 'PICKUP_LEAD_TIME', detail: message.slice('PICKUP_LEAD_TIME:'.length) });
    if (message === 'DELIVERY_FEE_CHANGED') return res.status(409).json({ error: 'DELIVERY_FEE_CHANGED' });
    if (message === 'COUPON_INVALID') return res.status(400).json({ error: 'COUPON_INVALID' });
    if (message === 'COUPON_EXPIRED') return res.status(400).json({ error: 'COUPON_EXPIRED' });
    if (message === 'COUPON_MIN_NOT_MET') return res.status(400).json({ error: 'COUPON_MIN_NOT_MET' });
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
  if (message === 'ZELOMENU_ACCESS_REQUIRED') return void res.status(403).json({ error: message });
  if (message === 'INVALID_SLUG') return void res.status(400).json({ error: 'INVALID_SLUG' });
  if (message === 'RESERVED_SLUG') return void res.status(400).json({ error: 'RESERVED_SLUG' });
  if (message === 'SLUG_TAKEN') return void res.status(409).json({ error: 'SLUG_TAKEN' });
  if (message === 'COUPON_CODE_TAKEN') return void res.status(409).json({ error: 'COUPON_CODE_TAKEN' });
  if (message === 'COUPON_INVALID_CODE') return void res.status(400).json({ error: 'COUPON_INVALID_CODE' });
  if (message === 'COUPON_INVALID_DISCOUNT_VALUE') return void res.status(400).json({ error: 'COUPON_INVALID_DISCOUNT_VALUE' });
  if (message === 'COUPON_NOT_FOUND') return void res.status(404).json({ error: 'COUPON_NOT_FOUND' });
  if (message === 'PIX_KEY_INVALID') return void res.status(400).json({ error: 'PIX_KEY_INVALID' });
  if (message === 'BUSINESS_HOURS_INVALID') return void res.status(400).json({ error: 'BUSINESS_HOURS_INVALID' });
  if (message === 'BUSINESS_HOURS_UNAVAILABLE') return void res.status(503).json({ error: 'BUSINESS_HOURS_UNAVAILABLE' });
  if (message === 'AUTO_ACCEPT_SETTINGS_UNAVAILABLE') return void res.status(503).json({ error: 'AUTO_ACCEPT_SETTINGS_UNAVAILABLE' });
  if (message === 'DELIVERY_CONFIGURATION_INVALID') return void res.status(400).json({ error: 'DELIVERY_CONFIGURATION_INVALID' });
  if (message === 'DELIVERY_ESTIMATED_MINUTES_INVALID') return void res.status(400).json({ error: 'DELIVERY_ESTIMATED_MINUTES_INVALID' });
  if (message === 'DELIVERY_SETTINGS_SAVE_FAILED') return void res.status(503).json({ error: 'DELIVERY_SETTINGS_SAVE_FAILED' });
  if (message === 'QUOTE_REQUEST_NOT_FOUND') return void res.status(404).json({ error: 'QUOTE_REQUEST_NOT_FOUND' });
  if (message === 'QUOTE_REQUEST_NOT_PENDING') return void res.status(409).json({ error: 'QUOTE_REQUEST_NOT_PENDING' });
  if (message === 'QUOTE_REQUEST_MISSING_ADDRESS') return void res.status(400).json({ error: 'QUOTE_REQUEST_MISSING_ADDRESS' });
  if (message === 'CART_SESSION_NOT_OPEN') return void res.status(409).json({ error: 'CART_SESSION_NOT_OPEN' });
  if (message === 'DELIVERY_QUOTE_RESOLUTION_FAILED') return void res.status(503).json({ error: 'DELIVERY_QUOTE_RESOLUTION_FAILED' });
  if (message === 'INVALID_FEE') return void res.status(400).json({ error: 'INVALID_FEE' });
  if (message === 'SCHEDULING_LEAD_TIME_INVALID') return void res.status(400).json({ error: 'SCHEDULING_LEAD_TIME_INVALID' });
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// Every ZeloMenu admin endpoint keeps the login barrier but requires an active
// ZeloMenu entitlement before reaching the route handler.
app.use('/api/admin/zelomenu', async (req, res, next) => {
  try {
    await requireZeloMenuAccess(req);
    next();
  } catch (error) {
    sendAdminError(res, error);
  }
});

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
    const { logoUrl, coverUrl, description, welcomeText, featuredEnabled, featuredProductIds, recommendationsEnabled, recommendationProductIds, categorySuggestions, categoryOrder, pixKey, pixKeyType, autoAcceptOrders, weeklyHours, schedulingEnabled, schedulingLeadTimeMinutes } = req.body ?? {};
    await updateZeloMenuStoreSettings(empresaId, {
      ...(logoUrl !== undefined && { logoUrl: typeof logoUrl === 'string' ? logoUrl.slice(0, 1000) : null }),
      ...(coverUrl !== undefined && { coverUrl: typeof coverUrl === 'string' ? coverUrl.slice(0, 1000) : null }),
      ...(description !== undefined && { description: typeof description === 'string' ? description.slice(0, 180) : null }),
      ...(welcomeText !== undefined && { welcomeText: typeof welcomeText === 'string' ? welcomeText.slice(0, 500) : null }),
      ...(featuredEnabled !== undefined && { featuredEnabled: Boolean(featuredEnabled) }),
      ...(Array.isArray(featuredProductIds) && { featuredProductIds: featuredProductIds.map(Number).filter(Boolean) }),
      ...(recommendationsEnabled !== undefined && { recommendationsEnabled: Boolean(recommendationsEnabled) }),
      ...(Array.isArray(recommendationProductIds) && { recommendationProductIds: recommendationProductIds.map(Number).filter(Boolean) }),
      ...(typeof categorySuggestions === 'object' && categorySuggestions !== null && !Array.isArray(categorySuggestions) && { categorySuggestions }),
      ...(Array.isArray(categoryOrder) && { categoryOrder: categoryOrder.map(String) }),
      ...(pixKey !== undefined && { pixKey: typeof pixKey === 'string' ? pixKey.slice(0, 200) : null }),
      ...(pixKeyType !== undefined && { pixKeyType: (typeof pixKeyType === 'string' && (PIX_KEY_TYPES as readonly string[]).includes(pixKeyType)) ? pixKeyType as PixKeyType : null }),
      ...(autoAcceptOrders !== undefined && { autoAcceptOrders: Boolean(autoAcceptOrders) }),
      ...(weeklyHours !== undefined && { weeklyHours }),
      ...(schedulingEnabled !== undefined && { schedulingEnabled: Boolean(schedulingEnabled) }),
      ...(schedulingLeadTimeMinutes !== undefined && { schedulingLeadTimeMinutes: Number(schedulingLeadTimeMinutes) }),
    });
    res.json({ ok: true });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// ─── AI welcome-text generation (admin, Bearer-authed) ─────────────────────────

app.get('/api/admin/zelomenu/metrics', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const metrics = await getZeloMenuOperationalMetrics(empresaId);
    res.json(metrics);
  } catch (error) {
    sendAdminError(res, error);
  }
});

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

// ─── Coupons (admin, Bearer-authed) ───────────────────────────────────────────

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
    const { code, discountType, discountValue, minOrderValue, startsAt, expiresAt, active } = req.body ?? {};
    const coupon = await createZeloMenuCoupon(ownerUserId, { code, discountType, discountValue, minOrderValue, startsAt, expiresAt, active });
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
    const { code, discountType, discountValue, minOrderValue, startsAt, expiresAt, active } = req.body ?? {};
    const coupon = await updateZeloMenuCoupon(ownerUserId, req.params.id, { code, discountType, discountValue, minOrderValue, startsAt, expiresAt, active });
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
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.PUBLIC_APP_VERSION?.trim() || undefined,
  });
});

// ─── Public business directory ───────────────────────────────────────────

app.get('/api/public/businesses', generalPublicLimiter, async (_req, res) => {
  try {
    const businesses = await listBusinesses();
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json({ data: businesses, meta: { total: businesses.length } });
  } catch (error) {
    console.error('[ZeloMenu] businesses listing error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.get('/api/public/push/config', generalPublicLimiter, (_req, res) => {
  const { publicKey, privateKey, publicKeyValid, privateKeyValid, keyPairValid } = getVapidConfig();
  const enabled = Boolean(publicKey && privateKey && publicKeyValid && privateKeyValid && keyPairValid);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    enabled,
    publicKey: enabled ? publicKey : null,
    error: enabled
      ? null
      : !publicKey || !privateKey
      ? 'VAPID_KEYS_MISSING'
      : !publicKeyValid
      ? 'VAPID_PUBLIC_KEY_INVALID'
      : !privateKeyValid
      ? 'VAPID_PRIVATE_KEY_INVALID'
      : 'VAPID_KEY_PAIR_INVALID',
  });
});

app.post('/api/public/push/subscriptions', generalPublicLimiter, async (req, res) => {
  try {
    const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId : '';
    const subscription = req.body?.subscription as PublicPushSubscriptionPayload | undefined;
    if (!clientId || !subscription || typeof subscription.endpoint !== 'string') {
      return res.status(400).json({ error: 'INVALID_PUSH_SUBSCRIPTION' });
    }

    const requestedOrderId = typeof req.body?.orderId === 'string' ? req.body.orderId : undefined;
    const cartToken = typeof req.body?.cartToken === 'string' ? req.body.cartToken : undefined;
    let validatedOrder: Awaited<ReturnType<typeof resolvePublicOrderSubscription>> = null;
    if (requestedOrderId || cartToken) {
      if (!cartToken) return res.status(400).json({ error: 'INVALID_PUSH_ORDER' });
      validatedOrder = await resolvePublicOrderSubscription(cartToken, requestedOrderId);
      if (!validatedOrder) return res.status(403).json({ error: 'INVALID_PUSH_ORDER' });
    }

    await savePublicPushSubscription({
      clientId,
      subscription,
      preferences: req.body?.preferences,
      orderId: validatedOrder?.orderId,
      cartToken: validatedOrder?.cartToken,
      orderRevision: validatedOrder?.revision,
      orderStatus: validatedOrder?.status,
    });
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_PUSH_SUBSCRIPTION') {
      return res.status(400).json({ error: error.message });
    }
    console.error('[ZeloMenu] save push subscription error:', error);
    return res.status(503).json({ error: 'PUSH_SUBSCRIPTION_UNAVAILABLE' });
  }
});

app.delete('/api/public/push/subscriptions', generalPublicLimiter, async (req, res) => {
  try {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint) return res.status(400).json({ error: 'INVALID_PUSH_SUBSCRIPTION' });
    await removePublicPushSubscription(endpoint);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[ZeloMenu] remove push subscription error:', error);
    return res.status(503).json({ error: 'PUSH_SUBSCRIPTION_UNAVAILABLE' });
  }
});

// ─── Delivery por distancia: admin ──────────────────────────────────────────

// GET /api/admin/zelomenu/delivery — aggregated delivery settings (address + ranges + enabled + pricing rules)
app.get('/api/admin/zelomenu/delivery', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const [address, ranges, storeData] = await Promise.all([
      getStoreDeliveryAddress(empresaId),
      listDeliveryRanges(empresaId),
      getDeliveryStoreData(empresaId),
    ]);
    const hasCoords = address.latitude != null && address.longitude != null;
    const geocodingStatus = !address.postalCode ? 'not_configured' : hasCoords ? 'ready' : 'error';
    res.json({
      enabled: storeData.enabledViaConfig,
      address: {
        postalCode: address.postalCode ?? '',
        number: address.number ?? '',
        complement: address.complement ?? null,
        street: address.street ?? '',
        neighborhood: address.neighborhood ?? '',
        city: address.city ?? '',
        state: address.state ?? '',
        latitude: address.latitude,
        longitude: address.longitude,
        locationVersion: String(address.locationVersion),
      },
      ranges: ranges.map((r) => ({ id: r.id, maxDistanceM: r.maxDistanceM, price: r.price })),
      estimatedDeliveryMinutes: storeData.estimatedDeliveryMinutes,
      geocodingStatus,
      pricingRules: storeData.pricingRules,
      pricingVersion: storeData.pricingVersion,
      timezone: storeData.timezone,
    });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// PATCH /api/admin/zelomenu/delivery — save delivery settings (address + ranges + enabled + pricing rules)
app.patch('/api/admin/zelomenu/delivery', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { enabled, address, ranges, pricingRules, estimatedDeliveryMinutes } = req.body ?? {};
    if (typeof enabled !== 'boolean' || !address || typeof address !== 'object' || !Array.isArray(ranges)) {
      throw new Error('DELIVERY_CONFIGURATION_INVALID');
    }
    await saveDeliverySettings(empresaId, {
      enabled,
      address: address as Record<string, unknown>,
      ranges,
      pricingRules: pricingRules as Array<Record<string, unknown>> | undefined,
      estimatedDeliveryMinutes: estimatedDeliveryMinutes as number | null | undefined,
    });
    res.json({ ok: true });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// GET /api/admin/zelomenu/delivery/quote-requests — operational fallback queue
app.get('/api/admin/zelomenu/delivery/quote-requests', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const requests = await listPendingDeliveryQuoteRequests(empresaId);
    res.json({ requests });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// GET /api/admin/zelomenu/delivery/quote-requests/:id — full detail of a quote request
app.get('/api/admin/zelomenu/delivery/quote-requests/:id', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const request = await getDeliveryQuoteRequestById(empresaId, req.params.id);
    if (!request) return res.status(404).json({ error: 'QUOTE_REQUEST_NOT_FOUND' });
    res.json(request);
  } catch (error) {
    sendAdminError(res, error);
  }
});

// POST /api/admin/zelomenu/delivery/quote-requests/:id/retry — recalculate quote
app.post('/api/admin/zelomenu/delivery/quote-requests/:id/retry', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const result = await retryDeliveryQuoteRequest(empresaId, req.params.id);
    res.json(result);
  } catch (error) {
    sendAdminError(res, error);
  }
});

// POST /api/admin/zelomenu/delivery/quote-requests/:id/resolve — manual fee
app.post('/api/admin/zelomenu/delivery/quote-requests/:id/resolve', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { fee } = req.body ?? {};
    if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0) {
      return res.status(400).json({ error: 'INVALID_FEE' });
    }
    await resolveDeliveryQuoteRequest(empresaId, req.params.id, fee);
    res.json({ ok: true });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// POST /api/admin/zelomenu/delivery/quote-requests/:id/cancel — cancel quote request
app.post('/api/admin/zelomenu/delivery/quote-requests/:id/cancel', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await cancelDeliveryQuoteRequest(empresaId, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// GET /api/admin/zelomenu/delivery/metrics — delivery operations metrics
app.get('/api/admin/zelomenu/delivery/metrics', async (req, res) => {
  try {
    await requireEmpresaId(req);
    res.json(metricsSnapshot());
  } catch (error) {
    sendAdminError(res, error);
  }
});

// GET /api/admin/zelomenu/delivery/health — provider health check
app.get('/api/admin/zelomenu/delivery/health', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const health = await getDeliveryHealth(empresaId);
    res.json(health);
  } catch (error) {
    sendAdminError(res, error);
  }
});

// POST /api/admin/zelomenu/delivery/cleanup-expired — expire stale quote requests
app.post('/api/admin/zelomenu/delivery/cleanup-expired', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const cleaned = await expireStaleQuoteRequests(empresaId);
    res.json({ expired: cleaned });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// POST /api/admin/zelomenu/delivery/lookup-cep — CEP lookup via ViaCEP cache
app.post('/api/admin/zelomenu/delivery/lookup-cep', async (req, res) => {
  try {
    await requireEmpresaId(req);
    const { postalCode } = req.body ?? {};
    if (!postalCode || typeof postalCode !== 'string') return res.status(400).json({ error: 'MISSING_POSTAL_CODE' });
    const result = await lookupCepOnly(postalCode);
    if (!result) return res.status(404).json({ error: 'ADDRESS_NOT_FOUND' });
    res.json(result);
  } catch (error) {
    sendAdminError(res, error);
  }
});

// POST /api/admin/zelomenu/delivery/geocode-store — geocode store address
app.post('/api/admin/zelomenu/delivery/geocode-store', async (req, res) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { postalCode, number } = req.body ?? {};
    if (!postalCode || !number) return res.status(400).json({ error: 'MISSING_FIELDS' });
    const canonical = await lookupCepOnly(String(postalCode));
    if (!canonical) return res.status(404).json({ error: 'ADDRESS_NOT_FOUND' });
    const deliveryAddress: DeliveryAddress = {
      postalCode: canonical.postalCode,
      number: String(number).trim(),
      complement: req.body.complement ?? null,
      street: canonical.street,
      neighborhood: canonical.neighborhood,
      city: canonical.city,
      state: canonical.state,
    };
    const coordinates = await resolveDeliveryStoreGeocoding(deliveryAddress);
    if (!coordinates) return res.status(422).json({ error: 'GEOCODING_UNAVAILABLE' });

    // Geocoding is a validation step for the editor, not a partial save.
    // The following PATCH contains the complete address + ranges and is the
    // only operation that persists the configuration. This is important for
    // companies migrating from the legacy neighborhood-based configuration:
    // they may not have delivery ranges in the new table yet.
    const current = await getStoreDeliveryAddress(empresaId);

    res.json({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      locationVersion: String(current.locationVersion + (current.latitude !== coordinates.latitude || current.longitude !== coordinates.longitude ? 1 : 0)),
    });
  } catch (error) {
    sendAdminError(res, error);
  }
});

// ─── Delivery por distancia: publico ────────────────────────────────────────

app.post('/api/public/zelomenu/delivery/cep', cepLookupLimiter, async (req, res) => {
  try {
    const { cep } = req.body ?? {};
    if (!cep) return res.status(400).json({ error: 'MISSING_CEP' });
    const address = await lookupCepOnly(cep);
    res.json({ address });
  } catch (error) {
    console.error('[ZeloMenu] CEP lookup error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ─── Serve built frontend in production ──────────────────────────────────────

const distPath = path.resolve(__dirname, '..', 'dist');
app.use('/assets', express.static(path.join(distPath, 'assets'), {
  maxAge: '1y',
  immutable: true,
}));
app.use(express.static(distPath, {
  maxAge: '1h',
}));

// Inject runtime env vars into the HTML so the frontend doesn't depend on
// build-time --build-arg. The server reads them from process.env (set via
// Dokploy runtime env or VPS .env file).
const runtimeEnv = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? '',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
};
const envScript = `<script>window.__ENV__ = ${JSON.stringify(runtimeEnv)};</script>`;

// `index.html` ships end-user copy (link previews for `/{slug}` etc. — the
// links actually shared with customers). `/admin` is the owner-only config
// panel and gets its own title/description swapped in server-side, since the
// SPA has a single static index.html and WhatsApp/social crawlers don't run JS.
const ADMIN_TITLE = 'ZeloMenu — Configuração do Cardápio';
const ADMIN_DESCRIPTION = 'Painel de configuração do cardápio ZeloMenu.';

let cachedDefaultHtml: string | null = null;
let cachedAdminHtml: string | null = null;

function withHeadTags(html: string, title: string, description: string): string {
  return html
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(/<meta name="description" content=".*?"\s*\/?>/s, `<meta name="description" content="${description}" />`)
    .replace(/<meta name="robots" content=".*?"\s*\/?>/s, '<meta name="robots" content="noindex, nofollow" />');
}

function getIndexHtml(isAdmin: boolean): string {
  if (isAdmin) {
    if (cachedAdminHtml) return cachedAdminHtml;
    const raw = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
    cachedAdminHtml = withHeadTags(raw, ADMIN_TITLE, ADMIN_DESCRIPTION).replace('</head>', `${envScript}\n  </head>`);
    return cachedAdminHtml;
  }
  if (cachedDefaultHtml) return cachedDefaultHtml;
  const raw = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
  cachedDefaultHtml = raw.replace('</head>', `${envScript}\n  </head>`);
  return cachedDefaultHtml;
}

// SPA fallback — any non-API request returns index.html with runtime env
app.get('*', (req, res) => {
  const isAdmin = req.path === '/admin' || req.path.startsWith('/admin/');
  res.type('html').send(getIndexHtml(isAdmin));
});

app.listen(PORT, () => {
  console.log(`[ZeloMenu] Server listening on port ${PORT}`);
  startOrderStatusPushDispatcher();
});
