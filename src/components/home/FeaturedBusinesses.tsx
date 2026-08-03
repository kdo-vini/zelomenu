import { BusinessGrid } from './BusinessGrid.tsx';
import { SectionHeader } from './SectionHeader.tsx';
import type { Business } from '../../data/types.ts';

interface FeaturedBusinessesProps {
  businesses: Business[];
}

export function FeaturedBusinesses({ businesses }: FeaturedBusinessesProps) {
  return (
    <section className="home-section" aria-labelledby="featured-businesses-title">
      <SectionHeader
        title="Empresas em destaque"
        description="Uma seleção de empresas que já utilizam o ZeloMenu."
        actionLabel="Ver todas"
        actionHref="#empresas"
      />
      <div id="featured-businesses-title" className="sr-only">Empresas em destaque</div>
      <BusinessGrid businesses={businesses} />
    </section>
  );
}
