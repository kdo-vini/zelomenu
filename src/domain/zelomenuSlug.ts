// ZeloMenu — slug público da loja (ZLM-203 / D-102).
// Domínio puro, node-free: usado pelo backend e pelo frontend.

const SLUG_MIN = 3;
const SLUG_MAX = 40;
const DIACRITICS = /[̀-ͯ]/g;

export function normalizeZeloMenuSlug(value: string): string | null {
  const slug = (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return null;
  return slug;
}

export function isValidZeloMenuSlug(value: string): boolean {
  const normalized = normalizeZeloMenuSlug(value);
  return normalized !== null && normalized === value;
}

export const RESERVED_ZELOMENU_SLUGS = new Set([
  'carrinho', 'store', 'stores', 'api', 'app', 'admin', 'menu', 'loja',
  'sobre', 'contato', 'suporte', 'null', 'undefined', 'www', 'auth', 'onboarding',
]);

export function isReservedZeloMenuSlug(slug: string): boolean {
  return RESERVED_ZELOMENU_SLUGS.has(slug);
}

export function buildPublicStorePath(slug: string): string {
  return `/${encodeURIComponent(slug)}`;
}

export function buildPublicCartPath(token: string): string {
  return `/menu/carrinho/${encodeURIComponent(token)}`;
}
