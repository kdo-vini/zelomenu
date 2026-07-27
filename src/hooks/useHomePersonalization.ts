import { useCallback, useEffect, useState } from 'react';
import {
  getFavoriteBusinessIds,
  getRecentBusinessIds,
  isBusinessFavorite,
  subscribeToPersonalization,
  toggleBusinessFavorite,
} from '../services/homePersonalization.ts';

export function useHomePersonalization() {
  const [favoriteIds, setFavoriteIds] = useState<string[]>(getFavoriteBusinessIds);
  const [recentIds, setRecentIds] = useState<string[]>(getRecentBusinessIds);

  useEffect(() => subscribeToPersonalization(() => {
    setFavoriteIds(getFavoriteBusinessIds());
    setRecentIds(getRecentBusinessIds());
  }), []);

  const toggleFavorite = useCallback((id: string) => {
    toggleBusinessFavorite(id);
    setFavoriteIds(getFavoriteBusinessIds());
  }, []);

  return { favoriteIds, recentIds, isFavorite: (id: string) => favoriteIds.includes(id), toggleFavorite };
}

export function useBusinessFavorite(id: string) {
  const [favorite, setFavorite] = useState(() => isBusinessFavorite(id));

  useEffect(() => subscribeToPersonalization(() => setFavorite(isBusinessFavorite(id))), [id]);

  const toggle = useCallback(() => {
    const next = toggleBusinessFavorite(id);
    setFavorite(next);
  }, [id]);

  return { favorite, toggle };
}
