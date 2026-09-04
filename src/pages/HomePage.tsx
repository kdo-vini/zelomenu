import { useMemo, useState } from 'react';
import { categories } from '../data/categories.ts';
import { filterBusinessesByLocation, type GeographicCoordinates } from '../domain/businessDeliveryRegion.ts';
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

type LocationStatus = 'idle' | 'loading' | 'granted' | 'denied' | 'unsupported';

export default function HomePage() {
  const businessesState = useBusinesses();
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [userCoordinates, setUserCoordinates] = useState<GeographicCoordinates | null>(null);
  const locationFilteredBusinesses = useMemo(() => {
    if (locationStatus !== 'granted' || !userCoordinates) return businessesState.data;
    return filterBusinessesByLocation(businessesState.data, userCoordinates);
  }, [businessesState.data, locationStatus, userCoordinates]);
  const discovery = useBusinessDiscovery(locationFilteredBusinesses);

  // Destaque editorial é uma camada de visibilidade, não um filtro de catálogo:
  // uma empresa pode aparecer na vitrine e continuar disponível para descoberta.
  const remainingBusinesses = discovery.filteredBusinesses;

  function scrollToResults() {
    document.getElementById('empresas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function requestLocation() {
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationStatus('unsupported');
      return;
    }

    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationStatus('granted');
      },
      () => setLocationStatus('denied'),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
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
          <NearbyBusinessesSection
            businesses={businessesState.status === 'success' ? locationFilteredBusinesses : []}
            status={locationStatus}
            coordinates={userCoordinates}
            onRequestLocation={requestLocation}
          />

          <QuickActions />

          {businessesState.status === 'success' ? (
            <HomePersonalizedSections businesses={locationFilteredBusinesses} />
          ) : null}

          <section className="home-categories" id="categorias" aria-labelledby="categories-title">
            <SectionHeader
              title="Explore por categorias"
              description="Encontre rapidamente o tipo de comida ou negócio que procura."
              titleId="categories-title"
            />
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
                titleId="all-businesses-title"
              />

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
                <EmptyState
                  onClear={discovery.clearFilters}
                  message={locationStatus === 'granted'
                    ? 'Nenhuma empresa com entrega atende sua localização.'
                    : undefined}
                />
              )}
            </section>
          )}

          {businessesState.status === 'success' ? (
            <HighlightsSection businesses={locationFilteredBusinesses} />
          ) : null}

          <EcosystemSection />

          <CTASection />
        </div>
      </main>
      <Footer />
    </div>
  );
}
