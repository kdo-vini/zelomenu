import type {
  ZeloMenuModifierGroup,
  ZeloMenuModifierOption,
} from '../domain/zelomenuModifiers';

// ─── Public row types ─────────────────────────────────────────────────────────

export type Categoria = {
  id: number;
  nome: string;
  ordem: number;
};

export type Subcategoria = {
  id: number;
  id_categoria: number;
  nome: string;
  ordem: number;
};

export type ProdutoRow = {
  tipo_produto?: 'simples' | 'pizza';
  pizza_config?: import('../domain/pizzaTypes').PizzaConfig | null;
  id: number;
  nome: string;
  preco: number;
  id_categoria: number | null;
  id_subcategoria: number | null;
  controlar_estoque: boolean;
  estoque_atual: number;
  eh_item_por_unidade: boolean;
  ocultar_no_pdv: boolean;
};

export type ZeloMenuProductPublicationRow = {
  id: string;
  id_produto: number;
  nome_publico: string | null;
  descricao_publica: string | null;
  foto_url: string | null;
  visivel_online: boolean;
  pausado_manualmente: boolean;
  ordem: number;
  updated_at?: string | null;
};

export type ZeloMenuModifierGroupRow = ZeloMenuModifierGroup;

export type ZeloMenuModifierOptionRow = ZeloMenuModifierOption & {
  groupId: string;
};

export type ZeloMenuModifierComponentRow = {
  id: string;
  nome: string;
  nome_chave: string;
  pausado_manualmente: boolean;
};

export type ZeloMenuModifierOptionProductLink = {
  productId: number | null;
  componentId: string | null;
  priceOverride: number | null;
};

// ─── Input types ──────────────────────────────────────────────────────────────

export type ProdutoInput = {
  nome: string;
  preco: number;
  id_categoria: number | null;
  id_subcategoria: number | null;
  controlar_estoque?: boolean;
  estoque_atual?: number;
  eh_item_por_unidade?: boolean;
  ocultar_no_pdv?: boolean;
};

export type ZeloMenuProductPublicationInput = {
  nome_publico?: string | null;
  descricao_publica?: string | null;
  foto_url?: string | null;
  visivel_online?: boolean;
  pausado_manualmente?: boolean;
  ordem?: number;
};

export type CategoriaInput = { nome: string; ordem?: number };
export type SubcategoriaInput = { nome: string; id_categoria: number; ordem?: number };

// ─── Shared internal state ────────────────────────────────────────────────────

export type CatalogState = {
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  produtos: ProdutoRow[];
  productPublications: Record<number, ZeloMenuProductPublicationRow>;
  productModifierGroups: Record<number, ZeloMenuModifierGroupRow[]>;
  modifierComponents: ZeloMenuModifierComponentRow[];
  modifierOptionProducts: Record<string, ZeloMenuModifierOptionProductLink>;
};

export const EMPTY: CatalogState = {
  categorias: [],
  subcategorias: [],
  produtos: [],
  productPublications: {},
  productModifierGroups: {},
  modifierComponents: [],
  modifierOptionProducts: {},
};

export type CommitFn = (updater: (previous: CatalogState) => CatalogState) => void;

// ─── Row normalizers ──────────────────────────────────────────────────────────

export function sortByOrdemNome<T extends { ordem: number; nome: string }>(a: T, b: T): number {
  if (a.ordem !== b.ordem) return a.ordem - b.ordem;
  return a.nome.localeCompare(b.nome);
}

export function normalizeProdutoRow(row: any): ProdutoRow {
  return {
    id: Number(row.id),
    nome: row.nome,
    preco: Number(row.preco ?? 0),
    tipo_produto: row.tipo_produto === 'pizza' ? 'pizza' : 'simples',
    pizza_config: row.pizza_config ?? null,
    id_categoria: row.id_categoria == null ? null : Number(row.id_categoria),
    id_subcategoria: row.id_subcategoria == null ? null : Number(row.id_subcategoria),
    controlar_estoque: !!row.controlar_estoque,
    estoque_atual: Number(row.estoque_atual ?? 0),
    eh_item_por_unidade: !!row.eh_item_por_unidade,
    ocultar_no_pdv: !!row.ocultar_no_pdv,
  };
}

export function normalizeProductPublicationRow(row: any): ZeloMenuProductPublicationRow {
  return {
    id: String(row.id),
    id_produto: Number(row.id_produto),
    nome_publico: normalizeOptionalText(row.nome_publico),
    descricao_publica: normalizeOptionalText(row.descricao_publica),
    foto_url: normalizeOptionalText(row.foto_url),
    visivel_online: !!row.visivel_online,
    pausado_manualmente: !!row.pausado_manualmente,
    ordem: Math.max(0, Number(row.ordem ?? 0)),
    updated_at: normalizeOptionalText(row.updated_at),
  };
}

export function normalizeModifierGroupRow(
  row: any,
  optionsByGroupId: Map<string, ZeloMenuModifierOptionRow[]>,
): ZeloMenuModifierGroupRow | null {
  const id = String(row.id ?? '').trim();
  const productId = Number(row.id_produto ?? 0);
  const name = normalizeOptionalText(row.nome);
  if (!id || !productId || !name) return null;
  return {
    id,
    productId,
    name,
    kind: row.tipo === 'variacao' ? 'variacao' : 'adicional',
    pricingMode: row.modo_preco === 'substituir' ? 'substituir' : 'somar',
    minSelections: Math.max(0, Number(row.min_selecoes ?? 0)),
    maxSelections: row.max_selecoes == null ? null : Math.max(1, Number(row.max_selecoes)),
    minTotalQuantity: Math.max(0, Number(row.minimo_total_quantidade ?? 0)),
    maxTotalQuantity: row.maximo_total_quantidade == null ? null : Math.max(0, Number(row.maximo_total_quantidade)),
    allowsQuantity: row.permite_quantidade === true,
    maxPerOption: row.maximo_por_opcao == null ? null : Math.max(1, Number(row.maximo_por_opcao)),
    active: row.ativo !== false,
    order: Math.max(0, Number(row.ordem ?? 0)),
    options: (optionsByGroupId.get(id) ?? []).map((option) => ({
      id: option.id,
      name: option.name,
      priceDelta: option.priceDelta,
      active: option.active,
      order: option.order,
    })),
  };
}

export function normalizeModifierOptionRow(row: any): ZeloMenuModifierOptionRow {
  return {
    id: String(row.id),
    groupId: String(row.id_grupo),
    name: normalizeOptionalText(row.nome) ?? '',
    priceDelta: Number(row.price_delta ?? 0),
    active: row.ativo !== false,
    order: Math.max(0, Number(row.ordem ?? 0)),
  };
}

export function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
