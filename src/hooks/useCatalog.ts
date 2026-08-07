import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { sortModifierGroups } from '../domain/zelomenuModifiers';
import {
  EMPTY,
  normalizeModifierGroupRow,
  normalizeModifierOptionRow,
  normalizeProductPublicationRow,
} from './useCatalogTypes';
import type { CatalogState, ZeloMenuModifierGroupRow, ZeloMenuModifierOptionRow } from './useCatalogTypes';
import { useCatalogCategories } from './useCatalogCategories';
import { useCatalogProducts } from './useCatalogProducts';
import { useCatalogModifiers } from './useCatalogModifiers';

// ─── Re-export all public types ───────────────────────────────────────────────

export type { Categoria, CategoriaInput, Subcategoria, SubcategoriaInput } from './useCatalogCategories';
export type {
  ProdutoRow,
  ProdutoInput,
  ZeloMenuProductPublicationRow,
  ZeloMenuProductPublicationInput,
} from './useCatalogProducts';
export type { ZeloMenuModifierGroupRow, ZeloMenuModifierOptionRow } from './useCatalogModifiers';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATALOG_CATEGORY_LIMIT = 500;
const CATALOG_SUBCATEGORY_LIMIT = 1000;
const CATALOG_PRODUCT_LIMIT = 2000;
const CATALOG_PUBLICATION_LIMIT = 2000;
const CATALOG_MODIFIER_GROUP_LIMIT = 4000;
const CATALOG_MODIFIER_OPTION_LIMIT = 8000;

type UseCatalogOptions = {
  enabled?: boolean;
};

export function useCatalog(session: Session | null, options: UseCatalogOptions = {}) {
  const [data, setData] = useState<CatalogState>(EMPTY);
  const dataRef = useRef<CatalogState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const userId = session?.user?.id ?? null;
  const enabled = options.enabled ?? true;

  const commitData = useCallback((updater: (previous: CatalogState) => CatalogState) => {
    setData((previous) => {
      const next = updater(previous);
      dataRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setData(EMPTY);
      setHasLoaded(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [catsRes, subsRes, prodsRes, publicationsRes, modifierGroupsRes, modifierOptionsRes, modifierOptionProductsRes] = await Promise.all([
        supabase
          .from('categorias')
          .select('id, nome, ordem')
          .eq('id_usuario', userId)
          .order('ordem')
          .order('nome')
          .limit(CATALOG_CATEGORY_LIMIT),
        supabase
          .from('subcategorias')
          .select('id, id_categoria, nome, ordem')
          .eq('id_usuario', userId)
          .order('ordem')
          .order('nome')
          .limit(CATALOG_SUBCATEGORY_LIMIT),
        supabase
          .from('produtos')
          .select('id, nome, preco, id_categoria, id_subcategoria, controlar_estoque, estoque_atual, eh_item_por_unidade, ocultar_no_pdv')
          .eq('id_usuario', userId)
          .order('nome')
          .limit(CATALOG_PRODUCT_LIMIT),
        supabase
          .from('zelomenu_product_publications')
          .select('id, id_produto, nome_publico, descricao_publica, foto_url, visivel_online, ordem')
          .eq('id_usuario', userId)
          .order('ordem')
          .limit(CATALOG_PUBLICATION_LIMIT),
        supabase
          .from('zelomenu_modifier_groups')
          .select('id, id_produto, nome, tipo, modo_preco, min_selecoes, max_selecoes, permite_quantidade, maximo_por_opcao, ativo, ordem')
          .eq('id_usuario', userId)
          .order('ordem')
          .limit(CATALOG_MODIFIER_GROUP_LIMIT),
        supabase
          .from('zelomenu_modifier_options')
          .select('id, id_grupo, nome, price_delta, ativo, ordem')
          .eq('id_usuario', userId)
          .order('ordem')
          .limit(CATALOG_MODIFIER_OPTION_LIMIT),
        supabase
          .from('zelomenu_modifier_option_products')
          .select('id_opcao, id_produto, price_override')
          .eq('id_usuario', userId)
          .limit(CATALOG_MODIFIER_OPTION_LIMIT),
      ]);
      if (catsRes.error) throw catsRes.error;
      if (subsRes.error) throw subsRes.error;
      if (prodsRes.error) throw prodsRes.error;
      if (publicationsRes.error) throw publicationsRes.error;
      if (modifierGroupsRes.error) throw modifierGroupsRes.error;
      if (modifierOptionsRes.error) throw modifierOptionsRes.error;
      if (modifierOptionProductsRes.error) throw modifierOptionProductsRes.error;
      const optionsByGroupId = new Map<string, ZeloMenuModifierOptionRow[]>();
      for (const row of modifierOptionsRes.data ?? []) {
        const option = normalizeModifierOptionRow(row);
        const existing = optionsByGroupId.get(option.groupId) ?? [];
        existing.push(option);
        optionsByGroupId.set(option.groupId, existing);
      }
      const modifierOptionProducts: Record<string, { productId: number; priceOverride: number | null }> = {};
      for (const row of modifierOptionProductsRes.data ?? []) {
        const optionId = String(row.id_opcao ?? '');
        const productId = Number(row.id_produto ?? 0);
        if (!optionId || !productId) continue;
        modifierOptionProducts[optionId] = {
          productId,
          priceOverride: row.price_override == null ? null : Number(row.price_override),
        };
      }
      const productModifierGroups = Object.fromEntries(
        (modifierGroupsRes.data ?? [])
          .map((row: any) => normalizeModifierGroupRow(row, optionsByGroupId))
          .filter((group): group is ZeloMenuModifierGroupRow => group !== null)
          .reduce<Array<[number, ZeloMenuModifierGroupRow[]]>>((entries, group) => {
            const match = entries.find((entry) => entry[0] === group.productId);
            if (match) {
              match[1].push(group);
              return entries;
            }
            entries.push([group.productId, [group]]);
            return entries;
          }, [])
          .map(([productId, groups]) => [productId, sortModifierGroups(groups)]),
      );
      const nextData: CatalogState = {
        categorias: (catsRes.data ?? []) as any[],
        subcategorias: (subsRes.data ?? []).map((r: any) => ({
          id: Number(r.id),
          id_categoria: Number(r.id_categoria),
          nome: r.nome,
          ordem: r.ordem ?? 0,
        })),
        produtos: (prodsRes.data ?? []).map((r: any) => ({
          id: Number(r.id),
          nome: r.nome,
          preco: Number(r.preco ?? 0),
          id_categoria: r.id_categoria == null ? null : Number(r.id_categoria),
          id_subcategoria: r.id_subcategoria == null ? null : Number(r.id_subcategoria),
          controlar_estoque: !!r.controlar_estoque,
          estoque_atual: Number(r.estoque_atual ?? 0),
          eh_item_por_unidade: !!r.eh_item_por_unidade,
          ocultar_no_pdv: !!r.ocultar_no_pdv,
        })),
        productPublications: Object.fromEntries(
          (publicationsRes.data ?? []).map((row: any) => {
            const publication = normalizeProductPublicationRow(row);
            return [publication.id_produto, publication];
          }),
        ),
        productModifierGroups,
        modifierOptionProducts,
      };
      dataRef.current = nextData;
      setData(nextData);
      setHasLoaded(true);
    } catch (err) {
      console.error('[Catalog] Failed to load catalog:', err);
      setError('Não foi possível carregar o catálogo. Tente novamente.');
      setHasLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const categories = useCatalogCategories(userId, dataRef, commitData);
  const products = useCatalogProducts(userId, dataRef, commitData);
  const modifiers = useCatalogModifiers(userId, dataRef, commitData);

  return {
    ...data,
    loading,
    error,
    hasLoaded,
    refresh,
    ...categories,
    ...products,
    ...modifiers,
  };
}
