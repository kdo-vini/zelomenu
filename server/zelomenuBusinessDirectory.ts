import { readAllRows } from '../src/utils/readAllRows.js';
import { getServiceSupabase } from './supabaseServer.js';
import { getEligibleZeloMenuUserIds } from './zelomenuAccess.js';

// Curadoria editorial independente dos produtos destacados no cardápio.
// Por enquanto, somente o Bem Servido entra nessa vitrine.
const CURATED_FEATURED_BUSINESS_SLUGS = new Set(['bemservido']);

export interface BusinessDirectoryEntry {
  id: string;
  slug: string | null;
  name: string;
  categoryLabel: string | null;
  city: string | null;
  state: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  maxDeliveryDistanceM: number | null;
  rating: number | null;
  ratingCount: number;
  highlights: BusinessDirectoryHighlight[];
  featured: boolean;
  sponsored: boolean;
  menuUrl: string | null;
}

export interface BusinessDirectoryHighlight {
  id: number;
  name: string;
  price: number;
  photoUrl: string | null;
}

/**
 * Lista empresas com perfil no ZeloMenu para a vitrine da Home.
 *
 * Retorna empresas que tenham `zelomenu_slug` preenchido (publicadas).
 * Quando não houver nenhuma, retorna array vazio — o frontend mostra o
 * empty state.
 *
 * A rota é pública (sem autenticação) e usa o client service-role.
 */
export async function listBusinesses(): Promise<BusinessDirectoryEntry[]> {
  const entries: BusinessDirectoryEntry[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = await listBusinessesPage(offset);
    entries.push(...page.entries);
    if (!page.hasMore) return entries.sort((a, b) => Number(b.sponsored) - Number(a.sponsored));
  }
}

async function listBusinessesPage(offset: number): Promise<{ entries: BusinessDirectoryEntry[]; hasMore: boolean }> {
  const supabase = getServiceSupabase();

  const baseSelect = 'id, user_id, nome_exibicao, endereco, logo_url, zelomenu_slug, delivery_city, delivery_state';
  const optionalSelect = 'zelomenu_cover_url, zelomenu_description, zelomenu_welcome_text, zelomenu_featured_enabled, zelomenu_featured_product_ids, zelomenu_sponsored_enabled, delivery_latitude, delivery_longitude, delivery_config';
  const initialProfilesResult = await supabase
    .from('empresa_perfil')
    .select(`${baseSelect}, ${optionalSelect}`)
    .not('zelomenu_slug', 'is', null)
    .order('id').range(offset, offset + 49);

  let profiles = initialProfilesResult.data as Array<Record<string, unknown>> | null;
  let error = initialProfilesResult.error;
  if (error && error.code !== '42703' && error.code !== 'PGRST204') throw error;

  // Keep the public directory available while a new optional column is being
  // rolled out. The migration is still the source of truth for new data.
  if (error?.message?.includes('zelomenu_cover_url')
    || error?.message?.includes('zelomenu_description')
    || error?.message?.includes('zelomenu_welcome_text')
    || error?.message?.includes('zelomenu_sponsored_enabled')
    || error?.message?.includes('delivery_latitude')
    || error?.message?.includes('delivery_longitude')) {
    const fallbackProfilesResult = await supabase
      .from('empresa_perfil')
      .select(`${baseSelect}, zelomenu_welcome_text, zelomenu_featured_enabled, zelomenu_featured_product_ids`)
      .not('zelomenu_slug', 'is', null)
      .order('id').range(offset, offset + 49);
    profiles = fallbackProfilesResult.data as Array<Record<string, unknown>> | null;
    error = fallbackProfilesResult.error;
  }

  if (error && error.code !== '42703' && error.code !== 'PGRST204') throw error;
  if (error) {
    const minimalProfilesResult = await supabase
      .from('empresa_perfil')
      .select(baseSelect)
      .not('zelomenu_slug', 'is', null)
      .order('id').range(offset, offset + 49);
    profiles = minimalProfilesResult.data as Array<Record<string, unknown>> | null;
    error = minimalProfilesResult.error;
  }

  if (error) throw error;

  if (!profiles || profiles.length === 0) return { entries: [], hasMore: false };

  const userIds = profiles
    .map((row: Record<string, unknown>) => String(row.user_id ?? '').trim())
    .filter(Boolean);
  const companyIds = profiles
    .map((row: Record<string, unknown>) => String(row.id ?? '').trim())
    .filter(Boolean);
  const featuredProductIds = [...new Set(profiles.flatMap((profile) => profile.zelomenu_featured_enabled === true && Array.isArray(profile.zelomenu_featured_product_ids)
    ? profile.zelomenu_featured_product_ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : []))];
  const [eligibleUserIds, deliveryRangesResult, productsAndPublicationsResult, categoriesResult] = await Promise.all([
    getEligibleZeloMenuUserIds(userIds),
    companyIds.length > 0
      ? supabase
          .from('zelomenu_delivery_ranges')
          .select('company_id, max_distance_m')
          .in('company_id', companyIds)
          .order('max_distance_m', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    userIds.length > 0 && featuredProductIds.length > 0
      ? Promise.all([
          readAllRows((from, to) => supabase
            .from('produtos')
            .select('id, id_usuario, nome, preco, controlar_estoque, estoque_atual')
            .in('id_usuario', userIds)
            .in('id', featuredProductIds)
            .order('id').range(from, to)),
          readAllRows((from, to) => supabase
            .from('zelomenu_product_publications')
            .select('id_usuario, id_produto, nome_publico, foto_url, visivel_online, pausado_manualmente, ordem')
            .in('id_usuario', userIds)
            .in('id_produto', featuredProductIds)
            .order('ordem')
            .order('id').range(from, to)),
        ])
      : Promise.resolve([{ data: [], error: null }, { data: [], error: null }]),
    userIds.length > 0
      ? readAllRows((from, to) => supabase
          .from('categorias')
          .select('id_usuario, nome, ordem')
          .in('id_usuario', userIds)
          .order('ordem')
          .order('nome')
          .order('id').range(from, to))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const eligibleProfiles = profiles.filter((row) => eligibleUserIds.has(String(row.user_id ?? '').trim()));
  if (eligibleProfiles.length === 0) return { entries: [], hasMore: profiles.length === 50 };

  const [productsResult, publicationsResult] = productsAndPublicationsResult;

  if (deliveryRangesResult.error) {
    console.warn('[ZeloMenu] Could not load directory delivery ranges:', deliveryRangesResult.error);
  }
  const maxDeliveryDistanceByCompany = new Map<string, number>();
  for (const range of deliveryRangesResult.data ?? []) {
    const companyId = String(range.company_id ?? '').trim();
    const maxDistanceM = Number(range.max_distance_m);
    if (!companyId || !Number.isFinite(maxDistanceM) || maxDistanceM <= 0) continue;
    maxDeliveryDistanceByCompany.set(companyId, Math.max(maxDistanceM, maxDeliveryDistanceByCompany.get(companyId) ?? 0));
  }
  if (productsResult.error || publicationsResult.error) {
    console.warn('[ZeloMenu] Could not load directory highlights:', productsResult.error ?? publicationsResult.error);
  }

  const productsByKey = new Map<string, Record<string, unknown>>();
  for (const product of productsResult.data ?? []) {
    const row = product as Record<string, unknown>;
    productsByKey.set(`${String(row.id_usuario)}:${String(row.id)}`, row);
  }
  const publicationsByKey = new Map<string, Record<string, unknown>>();
  for (const publication of publicationsResult.data ?? []) {
    const row = publication as Record<string, unknown>;
    publicationsByKey.set(`${String(row.id_usuario)}:${String(row.id_produto)}`, row);
  }

  const categoriesByUser = new Map<string, string[]>();
  for (const category of categoriesResult.data ?? []) {
    const row = category as Record<string, unknown>;
    const userId = String(row.id_usuario ?? '').trim();
    const name = String(row.nome ?? '').trim();
    if (!userId || !name) continue;
    const names = categoriesByUser.get(userId) ?? [];
    if (!names.includes(name)) names.push(name);
    categoriesByUser.set(userId, names);
  }

  const entries = eligibleProfiles.map((row: Record<string, unknown>) => {
    const city = String(row.delivery_city ?? '') || extractCityFromAddress(String(row.endereco ?? ''));
    const state = String(row.delivery_state ?? '') || extractStateFromAddress(String(row.endereco ?? ''));
    const slug = row.zelomenu_slug ? String(row.zelomenu_slug) : null;
    const userId = String(row.user_id ?? '').trim();
    const deliveryConfig = row.delivery_config as { enabled?: boolean } | null;
    const featuredIds = Array.isArray(row.zelomenu_featured_product_ids)
      ? row.zelomenu_featured_product_ids.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
      : [];
    const highlights = row.zelomenu_featured_enabled === true
      ? featuredIds.map((productId): BusinessDirectoryHighlight | null => {
          const product = productsByKey.get(`${userId}:${productId}`);
          const publication = publicationsByKey.get(`${userId}:${productId}`);
          if (!product || !publication || publication.visivel_online !== true || publication.pausado_manualmente === true) return null;
          if (product.controlar_estoque === true && Number(product.estoque_atual ?? 0) <= 0) return null;
          const name = String(publication.nome_publico ?? product.nome ?? '').trim();
          if (!name) return null;
          return {
            id: productId,
            name,
            price: Number(product.preco ?? 0),
            photoUrl: publication.foto_url ? String(publication.foto_url) : null,
          };
        }).filter((highlight): highlight is BusinessDirectoryHighlight => highlight !== null)
      : [];

    return {
      id: String(row.id),
      slug,
      name: String(row.nome_exibicao ?? ''),
      city,
      state,
      coverUrl: row.zelomenu_cover_url ? String(row.zelomenu_cover_url) : null,
      logoUrl: row.logo_url ? String(row.logo_url) : null,
      description: row.zelomenu_description
        ? String(row.zelomenu_description)
        : row.zelomenu_welcome_text
          ? String(row.zelomenu_welcome_text)
          : null,
      latitude: row.delivery_latitude != null && Number.isFinite(Number(row.delivery_latitude)) ? Number(row.delivery_latitude) : null,
      longitude: row.delivery_longitude != null && Number.isFinite(Number(row.delivery_longitude)) ? Number(row.delivery_longitude) : null,
      maxDeliveryDistanceM: deliveryConfig?.enabled === true ? maxDeliveryDistanceByCompany.get(String(row.id)) ?? null : null,
      rating: null,
      ratingCount: 0,
      categoryLabel: categoriesByUser.get(userId)?.slice(0, 2).join(' · ') || null,
      highlights,
      featured: slug != null && CURATED_FEATURED_BUSINESS_SLUGS.has(slug),
      sponsored: row.zelomenu_sponsored_enabled === true,
      menuUrl: slug ? `/${slug}` : null,
    };
  }).sort((a, b) => Number(b.sponsored) - Number(a.sponsored));
  return { entries, hasMore: profiles.length === 50 };
}

function extractCityFromAddress(address: string): string | null {
  if (!address) return null;
  // Tenta extrair padrões como "Cidade - UF" ou "Bairro, Cidade"
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const match = lastPart.match(/^([A-Za-zÀ-ÿ\s]+)\s*-\s*[A-Za-z]{2}$/);
    return match ? match[1].trim() : lastPart;
  }
  return parts[0] || null;
}

function extractStateFromAddress(address: string): string | null {
  if (!address) return null;
  const match = address.match(/\b([A-Za-z]{2})\s*$/);
  return match ? match[1].toUpperCase() : null;
}
