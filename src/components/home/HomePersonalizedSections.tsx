import { Heart, History } from 'lucide-react';
import type { Business } from '../../data/types.ts';
import { useHomePersonalization } from '../../hooks/useHomePersonalization.ts';
import { BusinessCarousel } from './BusinessCarousel.tsx';

interface HomePersonalizedSectionsProps {
  businesses: Business[];
}

export function HomePersonalizedSections({ businesses }: HomePersonalizedSectionsProps) {
  const { favoriteIds, recentIds } = useHomePersonalization();
  const byId = new Map(businesses.map((business) => [business.id, business]));
  const favorites = favoriteIds.map((id) => byId.get(id)).filter((business): business is Business => Boolean(business));
  const recentBusinesses = recentIds.map((id) => byId.get(id)).filter((business): business is Business => Boolean(business));

  if (!favorites.length && !recentBusinesses.length) return null;

  return (
    <div className="home-personalized-sections">
      {favorites.length ? (
        <section className="home-section home-personalized-section" aria-labelledby="favorite-businesses-title">
          <div className="home-section-header">
            <div>
              <h2>Favoritos</h2>
              <p>Suas empresas salvas neste dispositivo.</p>
            </div>
            <Heart size={22} fill="currentColor" aria-hidden="true" />
          </div>
          <h2 id="favorite-businesses-title" className="sr-only">Empresas favoritas</h2>
          <BusinessCarousel businesses={favorites} ariaLabel="empresas favoritas" />
        </section>
      ) : null}

      {recentBusinesses.length ? (
        <section className="home-section home-personalized-section" aria-labelledby="recent-businesses-title">
          <div className="home-section-header">
            <div>
              <h2>Últimas empresas visitadas</h2>
              <p>Retome um cardápio de onde você parou.</p>
            </div>
            <History size={22} aria-hidden="true" />
          </div>
          <h2 id="recent-businesses-title" className="sr-only">Últimas empresas visitadas</h2>
          <BusinessCarousel businesses={recentBusinesses} ariaLabel="últimas empresas visitadas" />
        </section>
      ) : null}
    </div>
  );
}
