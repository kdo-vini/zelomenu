import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { supabase } from '../services/supabaseClient';
import type {
  CatalogState,
  CommitFn,
  Categoria,
  CategoriaInput,
  Subcategoria,
  SubcategoriaInput,
} from './useCatalogTypes';
import { sortByOrdemNome } from './useCatalogTypes';

export function useCatalogCategories(
  userId: string | null,
  dataRef: MutableRefObject<CatalogState>,
  commitData: CommitFn,
) {
  const createCategoria = useCallback(async (input: CategoriaInput): Promise<Categoria> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const { data: row, error: dbError } = await supabase
      .from('categorias')
      .insert({ id_usuario: userId, nome: input.nome.trim(), ordem: input.ordem ?? 0 })
      .select('id, nome, ordem')
      .single();
    if (dbError) throw dbError;
    const created = row as Categoria;
    commitData((prev) => ({ ...prev, categorias: [...prev.categorias, created].sort(sortByOrdemNome) }));
    return created;
  }, [userId, commitData]);

  const updateCategoria = useCallback(async (id: number, patch: Partial<CategoriaInput>): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const update: Record<string, unknown> = {};
    if (patch.nome !== undefined) update.nome = patch.nome.trim();
    if (patch.ordem !== undefined) update.ordem = patch.ordem;
    const { error: dbError } = await supabase.from('categorias').update(update).eq('id', id).eq('id_usuario', userId);
    if (dbError) throw dbError;
    commitData((prev) => ({
      ...prev,
      categorias: prev.categorias.map((c) => (c.id === id ? { ...c, ...patch, nome: patch.nome?.trim() ?? c.nome } : c)).sort(sortByOrdemNome),
    }));
  }, [userId, commitData]);

  const deleteCategoria = useCallback(async (id: number): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const { error: dbError } = await supabase.from('categorias').delete().eq('id', id).eq('id_usuario', userId);
    if (dbError) throw dbError;
    commitData((prev) => ({
      ...prev,
      categorias: prev.categorias.filter((c) => c.id !== id),
      subcategorias: prev.subcategorias.filter((s) => s.id_categoria !== id),
      produtos: prev.produtos.map((p) => (p.id_categoria === id ? { ...p, id_categoria: null, id_subcategoria: null } : p)),
    }));
  }, [userId, commitData]);

  const reorderCategorias = useCallback(async (ordered: Categoria[]): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const previous = dataRef.current.categorias;
    const next = ordered.map((categoria, ordem) => ({ ...categoria, ordem }));
    commitData((current) => ({ ...current, categorias: next }));
    try {
      const results = await Promise.all(
        next.map((categoria) => supabase
          .from('categorias')
          .update({ ordem: categoria.ordem })
          .eq('id', categoria.id)
          .eq('id_usuario', userId)),
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    } catch (error) {
      commitData((current) => ({ ...current, categorias: previous }));
      throw error;
    }
  }, [userId, dataRef, commitData]);

  const createSubcategoria = useCallback(async (input: SubcategoriaInput): Promise<Subcategoria> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const { data: row, error: dbError } = await supabase
      .from('subcategorias')
      .insert({
        id_usuario: userId,
        id_categoria: input.id_categoria,
        nome: input.nome.trim(),
        ordem: input.ordem ?? 0,
      })
      .select('id, id_categoria, nome, ordem')
      .single();
    if (dbError) throw dbError;
    const created: Subcategoria = {
      id: Number((row as any).id),
      id_categoria: Number((row as any).id_categoria),
      nome: (row as any).nome,
      ordem: (row as any).ordem ?? 0,
    };
    commitData((prev) => ({ ...prev, subcategorias: [...prev.subcategorias, created].sort(sortByOrdemNome) }));
    return created;
  }, [userId, commitData]);

  const updateSubcategoria = useCallback(async (id: number, patch: Partial<SubcategoriaInput>): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const update: Record<string, unknown> = {};
    if (patch.nome !== undefined) update.nome = patch.nome.trim();
    if (patch.ordem !== undefined) update.ordem = patch.ordem;
    if (patch.id_categoria !== undefined) update.id_categoria = patch.id_categoria;
    const { error: dbError } = await supabase.from('subcategorias').update(update).eq('id', id).eq('id_usuario', userId);
    if (dbError) throw dbError;
    commitData((prev) => ({
      ...prev,
      subcategorias: prev.subcategorias
        .map((s) => (s.id === id ? { ...s, ...patch, nome: patch.nome?.trim() ?? s.nome } : s))
        .sort(sortByOrdemNome),
    }));
  }, [userId, commitData]);

  const deleteSubcategoria = useCallback(async (id: number): Promise<void> => {
    if (!userId) throw new Error('Faça login para continuar.');
    const { error: dbError } = await supabase.from('subcategorias').delete().eq('id', id).eq('id_usuario', userId);
    if (dbError) throw dbError;
    commitData((prev) => ({
      ...prev,
      subcategorias: prev.subcategorias.filter((s) => s.id !== id),
      produtos: prev.produtos.map((p) => (p.id_subcategoria === id ? { ...p, id_subcategoria: null } : p)),
    }));
  }, [userId, commitData]);

  return {
    createCategoria,
    updateCategoria,
    deleteCategoria,
    reorderCategorias,
    createSubcategoria,
    updateSubcategoria,
    deleteSubcategoria,
  };
}

export type { Categoria, CategoriaInput, Subcategoria, SubcategoriaInput };
