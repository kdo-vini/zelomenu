import type { Business } from '../data/types.ts';

type ServiceResult = Business[];

export const businessesService = {
  async list({ signal }: { signal?: AbortSignal } = {}): Promise<ServiceResult> {
    const response = await fetch('/api/public/businesses', {
      signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error('Falha ao carregar empresas');
    }

    const body = (await response.json()) as {
      data: Array<{
        id: string;
        slug: string | null;
        name: string;
        categoryLabel: string | null;
        city: string | null;
        state: string | null;
        coverUrl: string | null;
        logoUrl: string | null;
        description: string | null;
        latitude: number | null;
        longitude: number | null;
        rating: number | null;
        ratingCount: number;
        highlights: Array<{ id: number; name: string; price: number; photoUrl: string | null }>;
        featured: boolean;
        sponsored: boolean;
        menuUrl: string | null;
      }>;
      meta: { total: number };
    };

    return body.data
      .filter((b) => b.name && b.menuUrl)
      .map((b) => ({
        id: b.id,
        slug: b.slug ?? b.id,
        name: b.name,
        categoryId: 'all',
        categoryLabel: b.categoryLabel ?? 'Cardápio digital',
        city: b.city ?? '',
        state: b.state ?? '',
        coverUrl: b.coverUrl ?? '/assets/businesses/covers/default.jpg',
        logoUrl: b.logoUrl ?? '/assets/brand/logozelomenu-optimized.png',
        description: b.description ?? '',
        latitude: b.latitude ?? null,
        longitude: b.longitude ?? null,
        rating: b.rating ?? null,
        ratingCount: b.ratingCount ?? 0,
        highlights: b.highlights ?? [],
        featured: b.featured,
        sponsored: b.sponsored,
        menuUrl: b.menuUrl!,
      }));
  },
};
