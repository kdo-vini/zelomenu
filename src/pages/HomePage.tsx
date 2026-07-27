import { categories } from '../data/categories.ts';
import { useBusinessDiscovery } from '../hooks/useBusinessDiscovery.ts';
import { useBusinesses } from '../hooks/useBusinesses.ts';
import { Header } from '../components/home/Header.tsx';
import { Hero } from '../components/home/Hero.tsx';
import { QuickActions } from '../components/home/QuickActions.tsx';
import { CategoryFilters } from '../components/home/CategoryFilters.tsx';
import { SectionHeader } from '../components/home/SectionHeader.tsx';
import { FeaturedBusinesses } from '../components/home/FeaturedBusinesses.tsx';
import { BusinessGrid } from '../components/home/BusinessGrid.tsx';
import { BusinessCarousel } from '../components/home/BusinessCarousel.tsx';
import { EmptyState } from '../components/home/EmptyState.tsx';
import { ErrorState } from '../components/home/ErrorState.tsx';
import { BusinessGridSkeleton } from '../components/home/BusinessGridSkeleton.tsx';
import { HighlightsSection } from '../components/home/HighlightsSection.tsx';
import { HomePersonalizedSections } from '../components/home/HomePersonalizedSections.tsx';
import { NearbyBusinessesSection } from '../components/home/NearbyBusinessesSection.tsx';
import { EcosystemSection } from '../components/home/EcosystemSection.tsx';
import { CTASection } from '../components/home/CTASection.tsx';
import { Footer } from '../components/home/Footer.tsx';
import '../styles/tokens.css';
import '../styles/home.css';

export default function HomePage() {
  const businessesState = useBusinesses();
  const discovery = useBusinessDiscovery(businessesState.data);

  // Destaque editorial é uma camada de visibilidade, não um filtro de catálogo:
  // uma empresa pode aparecer na vitrine e continuar disponível para descoberta.
  const remainingBusinesses = discovery.filteredBusinesses;

  function scrollToResults() {
    document.getElementById('empresas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="zelo-home">
      <Header />
      <main>
        <Hero
          query={discovery.query}
          onQueryChange={discovery.setQuery}
          onClearQuery={() => discovery.setQuery('')}
          onSearch={scrollToResults}
        />

        <div className="home-container">
          <QuickActions />

          {businessesState.status === 'success' ? (
            <HomePersonalizedSections businesses={businessesState.data} />
          ) : null}

          {businessesState.status === 'success' ? (
            <NearbyBusinessesSection businesses={businessesState.data} />
          ) : null}

          <section className="home-categories" id="categorias" aria-labelledby="categories-title">
            <SectionHeader
              title="Explore por categorias"
              description="Encontre rapidamente o tipo de comida ou negócio que procura."
            />
            <h2 id="categories-title" className="sr-only">Categorias</h2>
            <CategoryFilters
              categories={categories}
              activeCategoryId={discovery.categoryId}
              onChange={discovery.setCategoryId}
            />
          </section>

          {businessesState.status === 'loading' ? (
            <section className="home-section" aria-label="Carregando empresas em destaque">
              <SectionHeader
                title="Empresas em destaque"
                description="Uma seleção de empresas que já utilizam o ZeloMenu."
              />
              <BusinessGridSkeleton count={4} />
            </section>
          ) : businessesState.status === 'success' && !discovery.hasActiveFilters ? (
            <FeaturedBusinesses businesses={discovery.featuredBusinesses} />
          ) : null}

          {businessesState.status === 'loading' ? (
            <section className="home-section" aria-label="Carregando empresas">
              <SectionHeader
                title="Mais empresas para descobrir"
                description="Acesse o cardápio da empresa e faça seu pedido."
              />
              <BusinessGridSkeleton count={8} />
            </section>
          ) : (
            <section className="home-section home-section--all" id="empresas" aria-labelledby="all-businesses-title">
              <SectionHeader
                title={discovery.hasActiveFilters ? 'Resultados da busca' : 'Empresas para descobrir'}
                description={
                  discovery.hasActiveFilters
                    ? `${discovery.filteredBusinesses.length} empresa${discovery.filteredBusinesses.length === 1 ? '' : 's'} encontrada${discovery.filteredBusinesses.length === 1 ? '' : 's'}.`
                    : 'Acesse o cardápio e peça direto pelo WhatsApp.'
                }
              />
              <h2 id="all-businesses-title" className="sr-only">Lista de empresas</h2>

              <div className="home-results-meta" aria-live="polite">
                {discovery.hasActiveFilters ? (
                  <span>
                    Filtros ativos: <strong>{discovery.categoryId === 'all' ? 'todas as categorias' : categories.find((item) => item.id === discovery.categoryId)?.label}</strong>
                  </span>
                ) : null}
                {discovery.hasActiveFilters ? (
                  <button type="button" onClick={discovery.clearFilters}>Limpar filtros</button>
                ) : null}
              </div>

              {businessesState.status === 'error' ? (
                <ErrorState onRetry={businessesState.retry} />
              ) : remainingBusinesses.length ? (
                discovery.hasActiveFilters ? (
                  <BusinessGrid businesses={remainingBusinesses} />
                ) : (
                  <BusinessCarousel businesses={remainingBusinesses} ariaLabel="empresas para descobrir" />
                )
              ) : (
                <EmptyState onClear={discovery.clearFilters} />
              )}
            </section>
          )}

          {businessesState.status === 'success' ? (
            <HighlightsSection businesses={businessesState.data} />
          ) : null}

          <EcosystemSection />

          <CTASection />
        </div>
      </main>
      <Footer />
    </div>
  );
}
