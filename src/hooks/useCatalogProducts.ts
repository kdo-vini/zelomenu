import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { supabase } from '../services/supabaseClient';
import {
  deleteOwnedZeloMenuPublicationImage,
  uploadOwnedZeloMenuPublicationImage,
} from '../services/zelomenuPublicationImages';
import type {
  CatalogState,
  CommitFn,
  ProdutoRow,
  ProdutoInput,
  ZeloMenuProductPublicationRow,
  ZeloMenuProductPublicationInput,
} from './useCatalogTypes';
import { normalizeProdutoRow, normalizeProductPublicationRow, normalizeOptionalText } from './useCatalogTypes';

export function useCatalogProducts(
  userId: string | null,
  dataRef: MutableRefObject<CatalogState>,
  commitData: CommitFn,
) {
  const createProduto = useCallback(async (input: ProdutoInput): Promise<ProdutoRow> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const payload = {
      id_usuario: userId,
      nome: input.nome.trim(),
      preco: input.preco,
      id_categoria: input.id_categoria,
      id_subcategoria: input.id_subcategoria,
      controlar_estoque: input.controlar_estoque ?? false,
      estoque_atual: input.estoque_atual ?? 0,
      eh_item_por_unidade: input.eh_item_por_unidade ?? false,
      ocultar_no_pdv: input.ocultar_no_pdv ?? false,
    };
    const { data: row, error: dbError } = await supabase
      .from('produtos')
      .insert(payload)
      .select('id, nome, preco, id_categoria, id_subcategoria, controlar_estoque, estoque_atual, eh_item_por_unidade, ocultar_no_pdv')
      .single();
    if (dbError) throw dbError;
    const created: ProdutoRow = normalizeProdutoRow(row);
    commitData((prev) => ({ ...prev, produtos: [...prev.produtos, created].sort((a, b) => a.nome.localeCompare(b.nome)) }));
    return created;
  }, [userId, commitData]);

  const updateProduto = useCallback(async (id: number, patch: Partial<ProdutoInput>): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const update: Record<string, unknown> = {};
    if (patch.nome !== undefined) update.nome = patch.nome.trim();
    if (patch.preco !== undefined) update.preco = patch.preco;
    if (patch.id_categoria !== undefined) update.id_categoria = patch.id_categoria;
    if (patch.id_subcategoria !== undefined) update.id_subcategoria = patch.id_subcategoria;
    if (patch.controlar_estoque !== undefined) update.controlar_estoque = patch.controlar_estoque;
    if (patch.estoque_atual !== undefined) update.estoque_atual = patch.estoque_atual;
    if (patch.eh_item_por_unidade !== undefined) update.eh_item_por_unidade = patch.eh_item_por_unidade;
    if (patch.ocultar_no_pdv !== undefined) update.ocultar_no_pdv = patch.ocultar_no_pdv;
    const { error: dbError } = await supabase.from('produtos').update(update).eq('id', id).eq('id_usuario', userId);
    if (dbError) throw dbError;
    commitData((prev) => ({
      ...prev,
      produtos: prev.produtos
        .map((p) => (p.id === id ? { ...p, ...patch, nome: patch.nome?.trim() ?? p.nome } as ProdutoRow : p))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    }));
  }, [userId, commitData]);

  const deleteProduto = useCallback(async (id: number): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const publicationPhotoUrl = dataRef.current.productPublications[id]?.foto_url ?? null;
    const { error: dbError } = await supabase.from('produtos').delete().eq('id', id).eq('id_usuario', userId);
    if (dbError) throw dbError;
    if (publicationPhotoUrl) {
      deleteOwnedZeloMenuPublicationImage(publicationPhotoUrl).catch((error) => {
        console.warn('[Catalog] Failed to remove owned publication image after product deletion:', error);
      });
    }
    commitData((prev) => {
      const { [id]: _removed, ...productPublications } = prev.productPublications;
      const { [id]: _removedGroups, ...productModifierGroups } = prev.productModifierGroups;
      return {
        ...prev,
        produtos: prev.produtos.filter((p) => p.id !== id),
        productPublications,
        productModifierGroups,
      };
    });
  }, [userId, dataRef, commitData]);

  const upsertProductPublication = useCallback(async (
    productId: number,
    patch: ZeloMenuProductPublicationInput,
  ): Promise<ZeloMenuProductPublicationRow> => {
    if (!userId) throw new Error('Faça login para continuar.');

    const current = dataRef.current.productPublications[productId];
    const nextText = (field: keyof Pick<ZeloMenuProductPublicationInput, 'nome_publico' | 'descricao_publica' | 'foto_url'>) => (
      Object.prototype.hasOwnProperty.call(patch, field)
        ? normalizeOptionalText(patch[field] ?? null)
        : normalizeOptionalText(current?.[field] ?? null)
    );
    const payload = {
      id_usuario: userId,
      id_produto: productId,
      nome_publico: nextText('nome_publico'),
      descricao_publica: nextText('descricao_publica'),
      foto_url: nextText('foto_url'),
      visivel_online: patch.visivel_online ?? current?.visivel_online ?? false,
      ordem: Math.max(0, Math.trunc(patch.ordem ?? current?.ordem ?? 0)),
      updated_at: new Date().toISOString(),
    };

    const { data: row, error: dbError } = await supabase
      .from('zelomenu_product_publications')
      .upsert(payload, { onConflict: 'id_usuario,id_produto' })
      .select('id, id_produto, nome_publico, descricao_publica, foto_url, visivel_online, ordem')
      .single();
    if (dbError) throw dbError;

    const saved = normalizeProductPublicationRow(row);
    commitData((prev) => ({
      ...prev,
      productPublications: { ...prev.productPublications, [productId]: saved },
    }));
    return saved;
  }, [userId, dataRef, commitData]);

  const reorderProductPublications = useCallback(async (orderedProductIds: number[]): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const previous = dataRef.current.productPublications;
    const optimistic = { ...previous };
    orderedProductIds.forEach((productId, ordem) => {
      const current = optimistic[productId];
      optimistic[productId] = current
        ? { ...current, ordem }
        : {
            id: `optimistic-${productId}`,
            id_produto: productId,
            nome_publico: null,
            descricao_publica: null,
            foto_url: null,
            visivel_online: false,
            pausado_manualmente: false,
            ordem,
          };
    });
    commitData((current) => ({ ...current, productPublications: optimistic }));

    try {
      const payload = orderedProductIds.map((productId, ordem) => {
        const current = previous[productId];
        return {
          id_usuario: userId,
          id_produto: productId,
          nome_publico: current?.nome_publico ?? null,
          descricao_publica: current?.descricao_publica ?? null,
          foto_url: current?.foto_url ?? null,
          visivel_online: current?.visivel_online ?? false,
          ordem,
          updated_at: new Date().toISOString(),
        };
      });
      const { data: rows, error: dbError } = await supabase
        .from('zelomenu_product_publications')
        .upsert(payload, { onConflict: 'id_usuario,id_produto' })
        .select('id, id_produto, nome_publico, descricao_publica, foto_url, visivel_online, ordem');
      if (dbError) throw dbError;
      const saved = { ...optimistic };
      for (const row of rows ?? []) {
        const publication = normalizeProductPublicationRow(row);
        saved[publication.id_produto] = publication;
      }
      commitData((current) => ({ ...current, productPublications: saved }));
    } catch (error) {
      commitData((current) => ({ ...current, productPublications: previous }));
      throw error;
    }
  }, [userId, dataRef, commitData]);

  const uploadProductPublicationImage = useCallback(async (
    productId: number,
    file: File,
    previousUrl?: string | null,
  ): Promise<string> => {
    if (!userId) throw new Error('Faça login para continuar.');
    return uploadOwnedZeloMenuPublicationImage(userId, productId, file, previousUrl);
  }, [userId]);

  const deleteProductPublicationImage = useCallback(async (url: string | null | undefined): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    await deleteOwnedZeloMenuPublicationImage(url);
  }, [userId]);

  return {
    createProduto,
    updateProduto,
    deleteProduto,
    upsertProductPublication,
    reorderProductPublications,
    uploadProductPublicationImage,
    deleteProductPublicationImage,
  };
}

export type { ProdutoRow, ProdutoInput, ZeloMenuProductPublicationRow, ZeloMenuProductPublicationInput };
