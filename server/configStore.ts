import { getServiceSupabase } from './supabaseServer.js';
import {
  resolveZeloMenuPublicationCatalogProduct,
  resolveZeloMenuModifierComponentAvailability,
  resolveZeloMenuLinkedOptionAvailability,
  summarizeZeloMenuPublication,
} from '../src/domain/zelomenuPublication.js';
import { resolveCatalogProductAvailability } from '../src/domain/zelomenuCatalog.js';
import { previewModifierPrice, resolveModifierOptionPrice, sortModifierGroups } from '../src/domain/zelomenuModifiers.js';
import type { ZeloMenuModifierGroup, ZeloMenuModifierOption, ZeloMenuLinkedModifierProduct } from '../src/domain/zelomenuModifiers.js';
import type { ZeloMenuProductPublication, ZeloMenuPublicationProduct, ZeloMenuPublicationSummary } from '../src/domain/zelomenuPublication.js';
import { deriveWeeklyFromLegacy, normalizeWeeklyHours, type WeeklyHours } from '../src/domain/businessHours.js';
import { isPixKeyType, type PixKeyType } from '../src/domain/pixBrCode.js';
import type { ConversationModifierGroupDefinition } from './conversationOrderRequirements.js';

// ─── Public types ──────────────────────────────────────────────────────────────

export type DeliveryNeighborhood = { name: string; fee: number };
export type DeliveryConfig = { enabled: boolean; neighborhoods: DeliveryNeighborhood[] };

export type PixReceiptConfig = {
  available: boolean;
  enabled: boolean;
  beneficiaryNames: string[];
  valueTolerance: number;
  maxAgeHours: number;
  fallback: string;
  minConfidence: number;
};

export type CatalogProduct = {
  id: number;
  name: string;
  price: number;
  basePrice: number;
  available: boolean;
  description?: string | null;
  photoUrl?: string | null;
  sortOrder?: number;
  unitBased?: boolean;
  stockControlled?: boolean;
  stockQuantity?: number;
  modifierGroups: ZeloMenuModifierGroup[];
};

export type CatalogCategoriaGroup = {
  nome: string;
  subcategorias: Array<{ nome: string; produtos: CatalogProduct[] }>;
  produtosDireto: CatalogProduct[];
};

export type ConversationCatalogDisplayPrice = {
  kind: 'fixed' | 'from';
  amount: number;
};

/**
 * Maps the cached catalog into the conversation contract without sorting or
 * filtering the cached arrays in place. Inactive options remain visible as
 * unavailable so a consumer never has to infer their current state.
 */
export function toConversationModifierGroups(
  groups: readonly ZeloMenuModifierGroup[],
): ConversationModifierGroupDefinition[] {
  return sortModifierGroups([...groups])
    .filter((group) => group.active)
    .map((group) => ({
      id: group.id,
      name: group.name,
      kind: group.kind,
      pricingMode: group.pricingMode,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      minTotalQuantity: group.minTotalQuantity,
      maxTotalQuantity: group.maxTotalQuantity,
      allowsQuantity: group.allowsQuantity,
      maxPerOption: group.maxPerOption,
      order: group.order,
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        currentPrice: resolveModifierOptionPrice(option),
        priceDelta: option.priceDelta,
        available: option.active && option.linkedProduct?.available !== false,
        order: option.order,
      })),
    }));
}

/** Resolves the cheapest complete required path shown before any selection. */
export function resolveConversationCatalogDisplayPrice(
  product: Pick<CatalogProduct, 'basePrice' | 'modifierGroups'>,
): ConversationCatalogDisplayPrice {
  const preview = previewModifierPrice([...product.modifierGroups], [], product.basePrice);
  return {
    kind: preview.hasRequiredGroup ? 'from' : 'fixed',
    amount: preview.unitPrice,
  };
}

export type BusinessConfig = {
  name: string;
  address: string;
  contato: string | null;
  openTime?: string;
  closeTime?: string;
  closedDays: string[];
  /**
   * Modelo por dia / múltiplas janelas (fonte: `empresa_perfil.horario_semanal`).
   * Quando a coluna é NULL, é derivado das colunas legadas — mantendo o
   * comportamento single-window idêntico. `[]` num dia = fechado naquele dia.
   */
  weeklyHours: WeeklyHours;
  timezone?: string;
  schedulingEnabled: boolean;
  schedulingLeadTimeMinutes: number;
  deliveryConfig: DeliveryConfig | null;
  pixReceiptConfig: PixReceiptConfig | null;
  /**
   * Chave Pix da loja + tipo declarado, para montar o Pix Copia e Cola do
   * pedido (`buildPixBrCode`). `null` quando a chave está vazia OU o tipo
   * ainda não foi declarado (11 dígitos crus são ambíguos entre cpf/celular
   * — sem o tipo, não geramos nada).
   */
  pixPayment: { key: string; keyType: PixKeyType } | null;
  publicationSummary: ZeloMenuPublicationSummary;
  catalogHierarchy: CatalogCategoriaGroup[];
  products: CatalogProduct[];
};

const DEFAULT_CONFIG: BusinessConfig = {
  name: '',
  address: '',
  contato: null,
  closedDays: [],
  weeklyHours: deriveWeeklyFromLegacy(null, null, null),
  schedulingEnabled: true,
  schedulingLeadTimeMinutes: 60,
  deliveryConfig: null,
  pixReceiptConfig: null,
  pixPayment: null,
  publicationSummary: {
    total: 0,
    published: 0,
    unpublished: 0,
    paused: 0,
    hidden: 0,
    outOfStock: 0,
    missingCategory: 0,
    attention: 0,
  },
  catalogHierarchy: [],
  products: [],
};

const configMap = new Map<string, BusinessConfig>();

export function getConfig(empresaId: string): BusinessConfig {
  return configMap.get(empresaId) ?? { ...DEFAULT_CONFIG };
}

// ─── Normalizers ───────────────────────────────────────────────────────────────

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDeliveryConfig(value: unknown): DeliveryConfig | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { enabled?: unknown; neighborhoods?: unknown };
  const neighborhoods = Array.isArray(row.neighborhoods)
    ? row.neighborhoods
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const n = item as { name?: unknown; fee?: unknown };
        const name = normalizeText(n.name);
        const fee = normalizeNumber(n.fee);
        if (!name || fee < 0) return null;
        return { name, fee };
      })
      .filter((item): item is DeliveryNeighborhood => item !== null)
    : [];
  return { enabled: row.enabled === true, neighborhoods };
}

function normalizePixReceiptConfig(value: unknown): PixReceiptConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const beneficiaryNames = Array.isArray(raw.beneficiaryNames)
    ? raw.beneficiaryNames.filter((v): v is string => typeof v === 'string')
    : [];
  return {
    available: raw.available === true,
    enabled: raw.enabled === true,
    beneficiaryNames,
    valueTolerance: normalizeNumber(raw.valueTolerance),
    maxAgeHours: normalizeNumber(raw.maxAgeHours) || 24,
    fallback: raw.fallback === 'ask_retry' ? 'ask_retry' : 'escalate_human',
    minConfidence: normalizeNumber(raw.minConfidence) || 0.8,
  };
}

function normalizePixPayment(chavePix: unknown, pixKeyType: unknown): { key: string; keyType: PixKeyType } | null {
  const key = normalizeText(chavePix);
  if (!key || !isPixKeyType(pixKeyType)) return null;
  return { key, keyType: pixKeyType };
}

type CatalogProductWithPlacement = CatalogProduct & {
  id: number;
  idCategoria: number | null;
  idSubcategoria: number | null;
  ocultarNoPdv: boolean;
};

function normalizeProductRow(row: unknown): CatalogProductWithPlacement | null {
  if (!row || typeof row !== 'object') return null;
  const product = row as {
    id?: unknown;
    nome?: unknown;
    preco?: unknown;
    id_categoria?: unknown;
    id_subcategoria?: unknown;
    eh_item_por_unidade?: unknown;
    ocultar_no_pdv?: unknown;
    controlar_estoque?: unknown;
    estoque_atual?: unknown;
  };
  const id = normalizeNumber(product.id);
  const name = normalizeText(product.nome);
  if (!id || !name) return null;
  const idCategoria = product.id_categoria == null ? null : normalizeNumber(product.id_categoria);
  const idSubcategoria = product.id_subcategoria == null ? null : normalizeNumber(product.id_subcategoria);
  const ocultarNoPdv = product.ocultar_no_pdv === true;
  const stockControlled = product.controlar_estoque === true;
  const stockQuantity = normalizeNumber(product.estoque_atual);
  return {
    id,
    name,
    price: normalizeNumber(product.preco),
    basePrice: normalizeNumber(product.preco),
    available: !stockControlled || stockQuantity > 0,
    unitBased: product.eh_item_por_unidade === true,
    stockControlled,
    stockQuantity,
    idCategoria,
    idSubcategoria,
    ocultarNoPdv,
    modifierGroups: [],
  };
}

function normalizeProductPublicationRow(row: unknown): ZeloMenuProductPublication | null {
  if (!row || typeof row !== 'object') return null;
  const publication = row as {
    id_produto?: unknown;
    nome_publico?: unknown;
    descricao_publica?: unknown;
    foto_url?: unknown;
    visivel_online?: unknown;
    pausado_manualmente?: unknown;
    ordem?: unknown;
  };
  const idProduto = normalizeNumber(publication.id_produto);
  if (!idProduto) return null;
  return {
    id_produto: idProduto,
    nome_publico: normalizeText(publication.nome_publico) || null,
    descricao_publica: normalizeText(publication.descricao_publica) || null,
    foto_url: normalizeText(publication.foto_url) || null,
    visivel_online: publication.visivel_online === true,
    pausado_manualmente: publication.pausado_manualmente === true,
    ordem: Math.max(0, Math.trunc(normalizeNumber(publication.ordem))),
  };
}

function normalizeModifierGroupRow(row: unknown): Omit<ZeloMenuModifierGroup, 'options'> | null {
  if (!row || typeof row !== 'object') return null;
  const group = row as {
    id?: unknown;
    id_produto?: unknown;
    nome?: unknown;
    tipo?: unknown;
    modo_preco?: unknown;
    min_selecoes?: unknown;
    max_selecoes?: unknown;
    minimo_total_quantidade?: unknown;
    maximo_total_quantidade?: unknown;
    permite_quantidade?: unknown;
    maximo_por_opcao?: unknown;
    ativo?: unknown;
    ordem?: unknown;
  };
  const id = normalizeText(group.id);
  const productId = normalizeNumber(group.id_produto);
  const name = normalizeText(group.nome);
  if (!id || !productId || !name) return null;
  return {
    id,
    productId,
    name,
    kind: group.tipo === 'variacao' ? 'variacao' : 'adicional',
    pricingMode: group.modo_preco === 'substituir' ? 'substituir' : 'somar',
    minSelections: Math.max(0, Math.trunc(normalizeNumber(group.min_selecoes))),
    maxSelections: group.max_selecoes == null ? null : Math.max(1, Math.trunc(normalizeNumber(group.max_selecoes))),
    minTotalQuantity: Math.max(0, Math.trunc(normalizeNumber(group.minimo_total_quantidade))),
    maxTotalQuantity: group.maximo_total_quantidade == null
      ? null
      : Math.max(0, Math.trunc(normalizeNumber(group.maximo_total_quantidade))),
    allowsQuantity: group.permite_quantidade === true,
    maxPerOption: group.maximo_por_opcao == null ? null : Math.max(1, Math.trunc(normalizeNumber(group.maximo_por_opcao))),
    active: group.ativo !== false,
    order: Math.max(0, Math.trunc(normalizeNumber(group.ordem))),
  };
}

function normalizeModifierOptionRow(row: unknown): (ZeloMenuModifierOption & { groupId: string }) | null {
  if (!row || typeof row !== 'object') return null;
  const option = row as {
    id?: unknown;
    id_grupo?: unknown;
    nome?: unknown;
    price_delta?: unknown;
    ativo?: unknown;
    ordem?: unknown;
  };
  const id = normalizeText(option.id);
  const groupId = normalizeText(option.id_grupo);
  const name = normalizeText(option.nome);
  if (!id || !groupId || !name) return null;
  return {
    id,
    groupId,
    name,
    priceDelta: normalizeNumber(option.price_delta),
    active: option.ativo !== false,
    order: Math.max(0, Math.trunc(normalizeNumber(option.ordem))),
  };
}

function toPublicCatalogProduct(product: CatalogProductWithPlacement): CatalogProduct {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    basePrice: product.basePrice,
    available: product.available,
    description: product.description ?? null,
    photoUrl: product.photoUrl ?? null,
    sortOrder: product.sortOrder ?? 0,
    unitBased: product.unitBased,
    stockControlled: product.stockControlled,
    stockQuantity: product.stockQuantity,
    modifierGroups: (product.modifierGroups ?? []).map((group) => ({
      id: group.id,
      productId: group.productId,
      name: group.name,
      kind: group.kind,
      pricingMode: group.pricingMode,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      minTotalQuantity: group.minTotalQuantity,
      maxTotalQuantity: group.maxTotalQuantity,
      allowsQuantity: group.allowsQuantity,
      maxPerOption: group.maxPerOption,
      active: group.active,
      order: group.order,
      options: group.options,
    })),
  };
}

function sortCatalogProducts(a: CatalogProductWithPlacement, b: CatalogProductWithPlacement): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
}

function buildCatalogHierarchy(
  categorias: unknown[],
  subcategorias: unknown[],
  produtos: Array<CatalogProductWithPlacement | null>,
): CatalogCategoriaGroup[] {
  const productRows = produtos.filter((item): item is CatalogProductWithPlacement => item !== null);
  const subRows = subcategorias
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { id?: unknown; id_categoria?: unknown; nome?: unknown };
      const nome = normalizeText(row.nome);
      if (!nome) return null;
      return {
        id: normalizeNumber(row.id),
        idCategoria: normalizeNumber(row.id_categoria),
        nome,
      };
    })
    .filter((item): item is { id: number; idCategoria: number; nome: string } => item !== null);

  return categorias
    .map((item): CatalogCategoriaGroup | null => {
      if (!item || typeof item !== 'object') return null;
      const row = item as { id?: unknown; nome?: unknown };
      const id = normalizeNumber(row.id);
      const nome = normalizeText(row.nome);
      if (!nome) return null;
      const productsInCategory = productRows.filter((p) => p.idCategoria === id);
      const subs = subRows
        .filter((sub) => sub.idCategoria === id)
        .map((sub) => ({
          nome: sub.nome,
          produtos: productsInCategory
            .filter((p) => p.idSubcategoria === sub.id)
            .sort(sortCatalogProducts)
            .map(toPublicCatalogProduct),
        }));
      return {
        nome,
        subcategorias: subs,
        produtosDireto: productsInCategory
          .filter((p) => p.idSubcategoria == null)
          .sort(sortCatalogProducts)
          .map(toPublicCatalogProduct),
      };
    })
    .filter((item): item is CatalogCategoriaGroup => item !== null);
}

// ─── Loader ───────────────────────────────────────────────────────────────────

// `chave_pix` já existe (compartilhada com o ZeloChat) — sempre selecionável.
const PERFIL_BASE_COLUMNS = 'user_id, nome_exibicao, endereco, contato, delivery_config, pix_receipt_config, horario_abertura, horario_fechamento, dias_fechamento, timezone, chave_pix';

/** `horario_semanal` e `zelomenu_pix_key_type` são colunas novas. Se alguma
 * ainda não existir neste banco, o select falha com 42703 — nesse caso
 * relemos com um conjunto de colunas reduzido e caímos no legado/default,
 * sem quebrar o carregamento do cardápio. */
function isMissingColumnError(error: { code?: string; message?: string } | null, columnNames: string[]): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const message = error.message ?? '';
  return columnNames.some((name) => message.includes(name));
}

export async function loadCatalogFromDb(empresaId: string): Promise<void> {
  const supabase = getServiceSupabase();

  let perfilRes = await supabase
    .from('empresa_perfil')
    .select(`${PERFIL_BASE_COLUMNS}, horario_semanal, zelomenu_pix_key_type, zelomenu_scheduling_enabled, zelomenu_scheduling_lead_time_minutes`)
    .eq('id', empresaId)
    .maybeSingle();
  if (perfilRes.error && isMissingColumnError(perfilRes.error, ['zelomenu_pix_key_type'])) {
    perfilRes = await supabase
      .from('empresa_perfil')
      .select(`${PERFIL_BASE_COLUMNS}, horario_semanal, zelomenu_scheduling_enabled, zelomenu_scheduling_lead_time_minutes`)
      .eq('id', empresaId)
      .maybeSingle();
  }
  if (perfilRes.error && isMissingColumnError(perfilRes.error, ['zelomenu_scheduling_enabled', 'zelomenu_scheduling_lead_time_minutes'])) {
    perfilRes = await supabase
      .from('empresa_perfil')
      .select(`${PERFIL_BASE_COLUMNS}, horario_semanal, zelomenu_pix_key_type`)
      .eq('id', empresaId)
      .maybeSingle();
  }
  if (perfilRes.error && isMissingColumnError(perfilRes.error, ['horario_semanal'])) {
    perfilRes = await supabase
      .from('empresa_perfil')
      .select(PERFIL_BASE_COLUMNS)
      .eq('id', empresaId)
      .maybeSingle();
  }
  const { data: perfilData, error: perfilError } = perfilRes;
  if (perfilError) throw perfilError;
  if (!perfilData) throw new Error(`empresa_perfil not found for ${empresaId}`);

  const row = perfilData as {
    user_id?: string | null;
    nome_exibicao?: string | null;
    endereco?: string | null;
    contato?: string | null;
    delivery_config?: unknown;
    pix_receipt_config?: unknown;
    horario_abertura?: string | null;
    horario_fechamento?: string | null;
    dias_fechamento?: unknown;
    horario_semanal?: unknown;
    timezone?: string | null;
    chave_pix?: string | null;
    zelomenu_pix_key_type?: string | null;
    zelomenu_scheduling_enabled?: boolean | null;
    zelomenu_scheduling_lead_time_minutes?: number | null;
  };

  const userId = normalizeText(row.user_id);
  if (!userId) throw new Error(`empresa_perfil.user_id missing for ${empresaId}`);

  const [categoriasRes, subcategoriasRes, produtosRes, publicationsRes, modifierGroupsRes, modifierOptionsRes, modifierComponentsRes, modifierOptionProductsRes] = await Promise.all([
    supabase.from('categorias').select('id, nome, ordem').eq('id_usuario', userId).order('ordem').order('nome'),
    supabase.from('subcategorias').select('id, id_categoria, nome, ordem').eq('id_usuario', userId).order('ordem').order('nome'),
    supabase.from('produtos').select('id, nome, preco, id_categoria, id_subcategoria, eh_item_por_unidade, ocultar_no_pdv, controlar_estoque, estoque_atual').eq('id_usuario', userId).order('nome'),
    supabase.from('zelomenu_product_publications').select('id_produto, nome_publico, descricao_publica, foto_url, visivel_online, pausado_manualmente, ordem').eq('id_usuario', userId).order('ordem').limit(2000),
    supabase.from('zelomenu_modifier_groups').select('id, id_produto, nome, tipo, modo_preco, min_selecoes, max_selecoes, minimo_total_quantidade, maximo_total_quantidade, permite_quantidade, maximo_por_opcao, ativo, ordem').eq('id_usuario', userId).order('ordem').limit(4000),
    supabase.from('zelomenu_modifier_options').select('id, id_grupo, nome, price_delta, ativo, ordem').eq('id_usuario', userId).order('ordem').limit(8000),
    supabase.from('zelomenu_modifier_components').select('id, nome, pausado_manualmente').eq('id_usuario', userId).limit(4000),
    supabase.from('zelomenu_modifier_option_products').select('id_opcao, id_produto, id_componente, price_override').eq('id_usuario', userId).limit(4000),
  ]);

  if (categoriasRes.error) throw categoriasRes.error;
  if (subcategoriasRes.error) throw subcategoriasRes.error;
  if (produtosRes.error) throw produtosRes.error;
  if (publicationsRes.error) throw publicationsRes.error;
  if (modifierGroupsRes.error) throw modifierGroupsRes.error;
  if (modifierOptionsRes.error) throw modifierOptionsRes.error;
  if (modifierComponentsRes.error) throw modifierComponentsRes.error;
  if (modifierOptionProductsRes.error) throw modifierOptionProductsRes.error;

  const publicationsByProductId = new Map<number, ZeloMenuProductPublication>();
  for (const pubRow of publicationsRes.data ?? []) {
    const publication = normalizeProductPublicationRow(pubRow);
    if (publication) publicationsByProductId.set(publication.id_produto, publication);
  }

  const optionsByGroupId = new Map<string, ZeloMenuModifierOption[]>();
  for (const optRow of modifierOptionsRes.data ?? []) {
    const option = normalizeModifierOptionRow(optRow);
    if (!option) continue;
    const existing = optionsByGroupId.get(option.groupId) ?? [];
    existing.push({ id: option.id, name: option.name, priceDelta: option.priceDelta, active: option.active, order: option.order });
    optionsByGroupId.set(option.groupId, existing);
  }

  const componentsById = new Map<string, { id: string; name: string; paused: boolean }>();
  for (const componentRow of modifierComponentsRes.data ?? []) {
    if (!componentRow || typeof componentRow !== 'object') continue;
    const component = componentRow as { id?: unknown; nome?: unknown; pausado_manualmente?: unknown };
    const id = normalizeText(component.id);
    const name = normalizeText(component.nome);
    if (!id || !name) continue;
    componentsById.set(id, { id, name, paused: component.pausado_manualmente === true });
  }

  // Sidecar links point to exactly one canonical identity: product or component.
  const optionProductsByOptionId = new Map<string, { productId: number | null; componentId: string | null; priceOverride: number | null }>();
  for (const linkRow of modifierOptionProductsRes.data ?? []) {
    if (!linkRow || typeof linkRow !== 'object') continue;
    const r = linkRow as { id_opcao?: unknown; id_produto?: unknown; id_componente?: unknown; price_override?: unknown };
    const optionId = normalizeText(r.id_opcao);
    const productId = r.id_produto == null ? null : normalizeNumber(r.id_produto);
    const componentId = normalizeText(r.id_componente) || null;
    if (!optionId || (!productId && !componentId)) continue;
    const priceOverride = r.price_override == null ? null : normalizeNumber(r.price_override);
    optionProductsByOptionId.set(optionId, { productId, componentId, priceOverride });
  }

  // Build a product lookup map for linked product resolution (name, price, photo, availability)
  const rawProductMap = new Map<number, CatalogProductWithPlacement>();
  const publicationProducts: ZeloMenuPublicationProduct[] = [];
  for (const rawRow of produtosRes.data ?? []) {
    const product = normalizeProductRow(rawRow);
    if (!product) continue;
    const publication = publicationsByProductId.get(product.id) ?? null;
    publicationProducts.push({
      id: product.id,
      nome: product.name,
      id_categoria: product.idCategoria,
      controlar_estoque: product.stockControlled === true,
      estoque_atual: product.stockQuantity ?? 0,
      ocultar_no_pdv: product.ocultarNoPdv,
      publication,
    });
    const resolved = resolveZeloMenuPublicationCatalogProduct({
      id: product.id,
      nome: product.name,
      name: product.name,
      price: product.price,
      id_categoria: product.idCategoria,
      controlar_estoque: product.stockControlled === true,
      estoque_atual: product.stockQuantity ?? 0,
      ocultar_no_pdv: product.ocultarNoPdv,
      unitBased: product.unitBased,
      stockControlled: product.stockControlled,
      stockQuantity: product.stockQuantity,
      publication,
      modifierGroups: [],
    });
    rawProductMap.set(product.id, {
      ...product,
      name: resolved.name,
      price: resolved.price,
      basePrice: resolved.price,
      available: resolved.available,
      description: resolved.description,
      photoUrl: resolved.photoUrl,
      sortOrder: resolved.sortOrder,
    });
  }

  const modifierGroupsByProductId = new Map<number, ZeloMenuModifierGroup[]>();
  for (const grpRow of modifierGroupsRes.data ?? []) {
    const group = normalizeModifierGroupRow(grpRow);
    if (!group) continue;
    const existing = modifierGroupsByProductId.get(group.productId) ?? [];
    const options = (optionsByGroupId.get(group.id) ?? []).map((option) => {
      const link = optionProductsByOptionId.get(option.id);
      if (!link) return option;
      if (link.componentId) {
        const component = componentsById.get(link.componentId) ?? null;
        return {
          ...option,
          linkedProduct: {
            productId: null,
            componentId: link.componentId,
            name: component?.name ?? option.name,
            photoUrl: null,
            price: link.priceOverride != null ? normalizeNumber(link.priceOverride) : option.priceDelta,
            available: component != null && resolveZeloMenuModifierComponentAvailability({
              pausado_manualmente: component.paused,
            }),
          } satisfies ZeloMenuLinkedModifierProduct,
        };
      }
      if (link.productId == null) return option;
      const linkedCatalogProduct = rawProductMap.get(link.productId) ?? null;
      if (!linkedCatalogProduct) {
        // Linked product was deleted — option becomes available: false until admin reconfigures
        return {
          ...option,
          linkedProduct: {
            productId: link.productId,
            name: '',
            photoUrl: null,
            price: 0,
            available: false,
          } satisfies ZeloMenuLinkedModifierProduct,
        };
      }
      const overridePrice = link.priceOverride != null ? normalizeNumber(link.priceOverride) : linkedCatalogProduct.price;
      const linkedOptionAvailable = resolveZeloMenuLinkedOptionAvailability({
        controlar_estoque: linkedCatalogProduct.stockControlled === true,
        estoque_atual: linkedCatalogProduct.stockQuantity ?? 0,
        ocultar_no_pdv: linkedCatalogProduct.ocultarNoPdv,
        publication: publicationsByProductId.get(link.productId) ?? null,
      });
      return {
        ...option,
        linkedProduct: {
          productId: link.productId,
          componentId: null,
          name: linkedCatalogProduct.name,
          photoUrl: linkedCatalogProduct.photoUrl ?? null,
          price: overridePrice,
          available: linkedOptionAvailable,
        } satisfies ZeloMenuLinkedModifierProduct,
      };
    });
    existing.push({ ...group, options });
    modifierGroupsByProductId.set(group.productId, existing);
  }
  for (const [productId, groups] of modifierGroupsByProductId.entries()) {
    modifierGroupsByProductId.set(productId, sortModifierGroups(groups));
  }

  const productsWithPlacement = [...rawProductMap.values()]
    .map((product) => {
      const modifierGroups = modifierGroupsByProductId.get(product.id) ?? [];
      const availability = resolveCatalogProductAvailability({
        ocultar_no_pdv: product.ocultarNoPdv,
        controlar_estoque: product.stockControlled,
        estoque_atual: product.stockQuantity,
      }, modifierGroups);
      return {
        ...product,
        available: product.available && availability.available,
        modifierGroups,
      };
    });

  const products = productsWithPlacement
    .filter((item): item is CatalogProductWithPlacement => item !== null)
    .sort(sortCatalogProducts)
    .map(toPublicCatalogProduct);

  const catalogHierarchy = buildCatalogHierarchy(
    categoriasRes.data ?? [],
    subcategoriasRes.data ?? [],
    productsWithPlacement,
  );
  const publicationSummary = summarizeZeloMenuPublication(publicationProducts);

  const closedDays = Array.isArray(row.dias_fechamento) ? (row.dias_fechamento as string[]) : [];
  const openTime = normalizeText(row.horario_abertura) || undefined;
  const closeTime = normalizeText(row.horario_fechamento) || undefined;
  // Modelo novo (`horario_semanal`) quando presente; senão deriva do legado —
  // lojas single-window mantêm exatamente o comportamento atual.
  const weeklyHours = normalizeWeeklyHours(row.horario_semanal)
    ?? deriveWeeklyFromLegacy(openTime, closeTime, closedDays);

  configMap.set(empresaId, {
    name: normalizeText(row.nome_exibicao) || 'Loja',
    address: normalizeText(row.endereco),
    contato: normalizeText(row.contato) || null,
    openTime,
    closeTime,
    closedDays,
    weeklyHours,
    schedulingEnabled: row.zelomenu_scheduling_enabled !== false,
    schedulingLeadTimeMinutes: row.zelomenu_scheduling_lead_time_minutes != null
      ? Math.max(0, Math.trunc(Number(row.zelomenu_scheduling_lead_time_minutes)))
      : 60,
    timezone: normalizeText(row.timezone) || undefined,
    deliveryConfig: normalizeDeliveryConfig(row.delivery_config),
    pixReceiptConfig: normalizePixReceiptConfig(row.pix_receipt_config),
    pixPayment: normalizePixPayment(row.chave_pix, row.zelomenu_pix_key_type),
    publicationSummary,
    catalogHierarchy,
    products,
  });
}
