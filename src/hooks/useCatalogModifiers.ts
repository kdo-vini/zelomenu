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

    const saved = sortModifierGroups(nextGroups);
    commitData((prev) => ({
      ...prev,
      productModifierGroups: {
        ...prev.productModifierGroups,
        [productId]: saved,
      },
    }));
    return saved;
  }, [userId, dataRef, commitData]);

  return { replaceProductModifierGroups };
}

export type { ZeloMenuModifierGroupRow, ZeloMenuModifierOptionRow };
