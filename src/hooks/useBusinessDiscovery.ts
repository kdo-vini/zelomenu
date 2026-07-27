import { useDeferredValue, useMemo, useState } from 'react';
import { normalizeText } from '../utils/normalizeText.ts';
import { categories } from '../data/categories.ts';
import type { Business } from '../data/types.ts';

interface UseBusinessDiscoveryReturn {
  query: string;
  setQuery: (value: string) => void;
  categoryId: string;
  setCategoryId: (value: string) => void;
  filteredBusinesses: Business[];
  featuredBusinesses: Business[];
  hasActiveFilters: boolean;
  clearFilters: () => void;
}

export function useBusinessDiscovery(allBusinesses: Business[]): UseBusinessDiscoveryReturn {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const deferredQuery = useDeferredValue(query);

  const filteredBusinesses = useMemo(() => {
    const normalizedQuery = normalizeText(deferredQuery);
    const activeCategory = categories.find((category) => category.id === categoryId);
    const normalizedCategory = normalizeText(activeCategory?.label ?? '');

    return allBusinesses.filter((business) => {
      const matchesCategory = categoryId === 'all'
        || business.categoryId === categoryId
        || normalizeText(business.categoryLabel).split(' · ').some((label) => label === normalizedCategory);
      if (!matchesCategory) return false;
      if (!normalizedQuery) return true;

      const haystack = normalizeText(
        `${business.name} ${business.categoryLabel} ${business.city} ${business.state}`,
      );

      return haystack.includes(normalizedQuery);
    });
  }, [allBusinesses, categoryId, deferredQuery]);

  const featuredBusinesses = useMemo(
    () => allBusinesses.filter((business) => business.featured),
    [allBusinesses],
  );

  const hasActiveFilters = Boolean(query.trim()) || categoryId !== 'all';

  function clearFilters() {
    setQuery('');
    setCategoryId('all');
  }

  return {
    query,
    setQuery,
    categoryId,
    setCategoryId,
    filteredBusinesses,
    featuredBusinesses,
    hasActiveFilters,
    clearFilters,
  };
}
