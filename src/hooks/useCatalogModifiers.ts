import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { supabase } from '../services/supabaseClient';
import type { ZeloMenuModifierGroupDraft } from '../domain/zelomenuModifiers';
import { sortModifierGroups } from '../domain/zelomenuModifiers';
import { normalizeCatalogSearchText } from '../domain/zelomenuCatalog';
import type {
  CatalogState,
  ZeloMenuModifierComponentRow,
  CommitFn,
  ZeloMenuModifierGroupRow,
  ZeloMenuModifierOptionRow,
} from './useCatalogTypes';

export function useCatalogModifiers(
  userId: string | null,
  dataRef: MutableRefObject<CatalogState>,
  commitData: CommitFn,
) {
  const replaceProductModifierGroups = useCallback(async (
    productId: number,
    groups: ZeloMenuModifierGroupDraft[],
  ): Promise<ZeloMenuModifierGroupRow[]> => {
    if (!userId) throw new Error('Faça login para continuar.');

    if (dataRef.current.produtos.find(p=>p.id===productId)?.tipo_produto === 'pizza') throw new Error('Edite os complementos da pizza no ZeloPDV.');
    const currentGroups = dataRef.current.productModifierGroups[productId] ?? [];
    const productsById = new Map(dataRef.current.produtos.map((product) => [product.id, product]));
    const nextGroups = groups.map((group, groupIndex) => {
      const groupId = group.id ?? globalThis.crypto.randomUUID();
      return {
        id: groupId,
        productId,
        name: group.name.trim(),
        kind: group.kind,
        pricingMode: group.pricingMode,
        minSelections: Math.max(0, Math.trunc(group.minSelections)),
        maxSelections: group.maxSelections == null ? null : Math.max(1, Math.trunc(group.maxSelections)),
        minTotalQuantity: Math.max(0, Math.trunc(group.minTotalQuantity)),
        maxTotalQuantity: group.maxTotalQuantity == null ? null : Math.max(0, Math.trunc(group.maxTotalQuantity)),
        allowsQuantity: group.allowsQuantity,
        maxPerOption: group.maxPerOption,
        active: group.active,
        order: Math.max(0, Math.trunc(group.order ?? groupIndex)),
        options: group.options.map((option, optionIndex) => ({
          id: option.id ?? globalThis.crypto.randomUUID(),
          name: option.name.trim(),
          priceDelta: Number(option.priceDelta ?? 0),
          active: true,
          order: Math.max(0, Math.trunc(option.order ?? optionIndex)),
          linkedProduct: option.linkedProductId
            ? {
                productId: option.linkedProductId,
                name: productsById.get(option.linkedProductId)?.nome ?? '',
                photoUrl: null,
                price: Number(option.priceOverride ?? productsById.get(option.linkedProductId)?.preco ?? 0),
                available: true,
              }
            : null,
        })),
      };
    });

    const currentGroupIds = new Set<string>(currentGroups.map((group) => group.id));
    const nextGroupIds = new Set<string>(nextGroups.map((group) => group.id));
    const currentOptionIds = new Set<string>(
      currentGroups.flatMap((group) => group.options.map((option) => option.id)),
    );
    const nextOptionIds = new Set<string>(
      nextGroups.flatMap((group) => group.options.map((option) => option.id)),
    );

    const groupsPayload = nextGroups.map((group) => ({
      id: group.id,
      id_usuario: userId,
      id_produto: productId,
      nome: group.name,
      tipo: group.kind,
      modo_preco: group.pricingMode,
      min_selecoes: group.minSelections,
      max_selecoes: group.maxSelections,
      minimo_total_quantidade: group.minTotalQuantity,
      maximo_total_quantidade: group.maxTotalQuantity,
      permite_quantidade: group.allowsQuantity,
      maximo_por_opcao: group.maxPerOption,
      ativo: group.active,
      ordem: group.order,
      updated_at: new Date().toISOString(),
    }));

    const optionsPayload = nextGroups.flatMap((group) => group.options.map((option) => ({
      id: option.id,
      id_usuario: userId,
      id_grupo: group.id,
      nome: option.name,
      price_delta: option.priceDelta,
      ativo: true,
      ordem: option.order,
      updated_at: new Date().toISOString(),
    })));

    if (groupsPayload.length > 0) {
      const { error: upsertGroupsError } = await supabase
        .from('zelomenu_modifier_groups')
        .upsert(groupsPayload, { onConflict: 'id' });
      if (upsertGroupsError) throw upsertGroupsError;
    }

    if (optionsPayload.length > 0) {
      const { error: upsertOptionsError } = await supabase
        .from('zelomenu_modifier_options')
        .upsert(optionsPayload, { onConflict: 'id' });
      if (upsertOptionsError) throw upsertOptionsError;
    }

    const staleOptionIds = [...currentOptionIds].filter((id) => !nextOptionIds.has(id));
    if (staleOptionIds.length > 0) {
      const { error: deleteOptionsError } = await supabase
        .from('zelomenu_modifier_options')
        .delete()
        .eq('id_usuario', userId)
        .in('id', staleOptionIds);
      if (deleteOptionsError) throw deleteOptionsError;
    }

    const staleGroupIds = [...currentGroupIds].filter((id) => !nextGroupIds.has(id));
    if (staleGroupIds.length > 0) {
      const { error: deleteGroupsError } = await supabase
        .from('zelomenu_modifier_groups')
        .delete()
        .eq('id_usuario', userId)
        .in('id', staleGroupIds);
      if (deleteGroupsError) throw deleteGroupsError;
    }

    // ── Sidecar (zelomenu_modifier_option_products) ─────────────────────────

    // Collect current sidecar option IDs for this product
    const currentSidecarOptionIds = new Set<string>(
      Object.keys(dataRef.current.modifierOptionProducts ?? {})
        .filter((optId) => currentOptionIds.has(optId)),
    );

    // Every option points to one canonical identity. Existing products stay
    // products; an option without a selected product receives/reuses one
    // internal component keyed by its normalized name.
    const nextSidecarOptionIds = new Set<string>();
    const sidecarUpsertPayload: Array<{
      id_opcao: string;
      id_usuario: string;
      id_produto: number | null;
      id_componente: string | null;
      price_override: number | null;
    }> = [];

    const componentByKey = new Map<string, ZeloMenuModifierComponentRow>();
    const componentNamesByKey = new Map<string, string>();
    for (const group of nextGroups) {
      for (const option of group.options) {
        if (option.linkedProduct || !option.name.trim()) continue;
        componentNamesByKey.set(normalizeCatalogSearchText(option.name), option.name.trim());
      }
    }
    for (const [nameKey, name] of componentNamesByKey) {
      if (!nameKey) continue;
      const existing = dataRef.current.modifierComponents.find((component) => component.nome_chave === nameKey);
      if (existing) {
        componentByKey.set(nameKey, existing);
        continue;
      }
      const { data: component, error: componentError } = await supabase
        .from('zelomenu_modifier_components')
        .upsert({ id_usuario: userId, nome: name, nome_chave: nameKey }, { onConflict: 'id_usuario,nome_chave' })
        .select('id, nome, nome_chave, pausado_manualmente')
        .single();
      if (componentError) throw componentError;
      componentByKey.set(nameKey, {
        id: String(component.id),
        nome: String(component.nome),
        nome_chave: String(component.nome_chave),
        pausado_manualmente: component.pausado_manualmente === true,
      });
    }

    const allOptionLinks = new Map<string, { productId: number | null; componentId: string | null; priceOverride: number | null }>();
    const draftLinksByOptionId = new Map(
      groups.flatMap((group) => group.options)
        .filter((option): option is typeof option & { id: string } => Boolean(option.id))
        .map((option) => [option.id, option]),
    );
    for (const group of nextGroups) {
      for (const option of group.options) {
        if (!option.id) continue;
        if (option.linkedProduct) {
          allOptionLinks.set(option.id, {
            productId: option.linkedProduct.productId,
            componentId: null,
            priceOverride: draftLinksByOptionId.get(option.id)?.priceOverride ?? null,
          });
          continue;
        }
        const component = componentByKey.get(normalizeCatalogSearchText(option.name));
        if (!component) throw new Error(`Não foi possível criar o item canônico “${option.name}”.`);
        allOptionLinks.set(option.id, {
          productId: null,
          componentId: component.id,
          priceOverride: option.priceDelta,
        });
      }
    }
    for (const [optId, link] of allOptionLinks) {
      nextSidecarOptionIds.add(optId);
      sidecarUpsertPayload.push({
        id_opcao: optId,
        id_usuario: userId,
        id_produto: link.productId,
        id_componente: link.componentId,
        price_override: link.priceOverride,
      });
    }

    // Delete stale sidecar rows (unlinked or deleted options that had a link)
    const staleSidecarOptionIds = [...currentSidecarOptionIds].filter(
      (id) => !nextSidecarOptionIds.has(id),
    );
    if (staleSidecarOptionIds.length > 0) {
      const { error: deleteSidecarError } = await supabase
        .from('zelomenu_modifier_option_products')
        .delete()
        .eq('id_usuario', userId)
        .in('id_opcao', staleSidecarOptionIds);
      if (deleteSidecarError) throw deleteSidecarError;
    }

    // Upsert current sidecar rows
    if (sidecarUpsertPayload.length > 0) {
      const { error: upsertSidecarError } = await supabase
        .from('zelomenu_modifier_option_products')
        .upsert(sidecarUpsertPayload, { onConflict: 'id_opcao' });
      if (upsertSidecarError) throw upsertSidecarError;
    }

    // ── Update local state ───────────────────────────────────────────────────

    const newModifierOptionProducts = { ...dataRef.current.modifierOptionProducts };
    // Remove stale sidecar entries
    for (const id of staleSidecarOptionIds) {
      delete newModifierOptionProducts[id];
    }
    // Add/update new sidecar entries
    for (const entry of sidecarUpsertPayload) {
      newModifierOptionProducts[entry.id_opcao] = {
        productId: entry.id_produto,
        componentId: entry.id_componente,
        priceOverride: entry.price_override,
      };
    }

    const saved = sortModifierGroups(nextGroups);
    commitData((prev) => ({
      ...prev,
      productModifierGroups: {
        ...prev.productModifierGroups,
        [productId]: saved,
      },
      modifierComponents: [
        ...prev.modifierComponents.filter((component) => !componentByKey.has(component.nome_chave)),
        ...componentByKey.values(),
      ].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      modifierOptionProducts: newModifierOptionProducts,
    }));
    return saved;
  }, [userId, dataRef, commitData]);

  const setModifierComponentAvailability = useCallback(async (componentId: string, active: boolean): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');

    const { error } = await supabase
      .from('zelomenu_modifier_components')
      .update({ pausado_manualmente: !active, updated_at: new Date().toISOString() })
      .eq('id_usuario', userId)
      .eq('id', componentId);
    if (error) throw error;

    commitData((previous) => ({
      ...previous,
      modifierComponents: previous.modifierComponents.map((component) => (
        component.id === componentId ? { ...component, pausado_manualmente: !active } : component
      )),
    }));
  }, [userId, commitData]);

  return { replaceProductModifierGroups, setModifierComponentAvailability };
}

export type { ZeloMenuModifierGroupRow, ZeloMenuModifierOptionRow };
