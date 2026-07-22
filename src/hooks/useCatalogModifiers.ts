import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { supabase } from '../services/supabaseClient';
import type { ZeloMenuModifierGroupDraft } from '../domain/zelomenuModifiers';
import { sortModifierGroups } from '../domain/zelomenuModifiers';
import type {
  CatalogState,
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

    const currentGroups = dataRef.current.productModifierGroups[productId] ?? [];
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
        active: group.active,
        order: Math.max(0, Math.trunc(group.order ?? groupIndex)),
        options: group.options.map((option, optionIndex) => ({
          id: option.id ?? globalThis.crypto.randomUUID(),
          name: option.name.trim(),
          priceDelta: Number(option.priceDelta ?? 0),
          active: option.active,
          order: Math.max(0, Math.trunc(option.order ?? optionIndex)),
          linkedProduct: option.linkedProductId
            ? { productId: option.linkedProductId, name: '', photoUrl: null, price: Number(option.priceOverride ?? 0), available: true }
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
      ativo: option.active,
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

    // Collect next sidecar entries from the original drafts (have linkedProductId/priceOverride)
    const nextSidecarOptionIds = new Set<string>();
    const sidecarUpsertPayload: Array<{
      id_opcao: string;
      id_usuario: string;
      id_produto: number;
      price_override: number | null;
    }> = [];

    // Build a map of draft groupId -> group for quick lookup by option ID
    const allOptionLinks = new Map<string, { productId: number; priceOverride: number | null }>();
    for (const group of groups) {
      for (const option of group.options) {
        if (option.id && option.linkedProductId) {
          allOptionLinks.set(option.id, { productId: option.linkedProductId, priceOverride: option.priceOverride ?? null });
        }
      }
    }
    for (const [optId, link] of allOptionLinks) {
      nextSidecarOptionIds.add(optId);
      sidecarUpsertPayload.push({
        id_opcao: optId,
        id_usuario: userId,
        id_produto: link.productId,
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
      modifierOptionProducts: newModifierOptionProducts,
    }));
    return saved;
  }, [userId, dataRef, commitData]);

  return { replaceProductModifierGroups };
}

export type { ZeloMenuModifierGroupRow, ZeloMenuModifierOptionRow };
