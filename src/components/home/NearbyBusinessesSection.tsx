import { useMemo } from 'react';
import { ArrowRight, LocateFixed, MapPin } from 'lucide-react';
import type { Business } from '../../data/types.ts';
import { distanceInKm, type GeographicCoordinates } from '../../domain/businessDeliveryRegion.ts';
import { BusinessCarousel } from './BusinessCarousel.tsx';

interface NearbyBusinessesSectionProps {
  businesses: Business[];
  status: 'idle' | 'loading' | 'granted' | 'denied' | 'unsupported';
  coordinates: GeographicCoordinates | null;
  onRequestLocation: () => void;
}

function formatDistance(distanceKm: number): string {
  return distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1).replace('.', ',')} km`;
}

export function NearbyBusinessesSection({
  businesses,
  status,
  coordinates,
  onRequestLocation,
}: NearbyBusinessesSectionProps) {
  const nearby = useMemo(() => {
    if (!coordinates) return [];
    return businesses
      .filter((business) => business.latitude != null && business.longitude != null)
      .map((business) => ({
        business,
        distance: distanceInKm(coordinates, { latitude: business.latitude!, longitude: business.longitude! }),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);
  }, [businesses, coordinates]);

  return (
    <section className="home-section home-nearby" aria-labelledby="nearby-businesses-title">
      <div className="home-section-header">
        <div>
          <h2 id="nearby-businesses-title">Perto de você</h2>
          <p>Encontre empresas da sua região sem precisar informar o endereço.</p>
        </div>
        <MapPin size={22} aria-hidden="true" />
      </div>

      {status === 'idle' || status === 'unsupported' ? (
        <div className="home-nearby__prompt">
          <div className="home-nearby__prompt-icon"><LocateFixed size={22} aria-hidden="true" /></div>
          <div>
            <strong>Mostre opções próximas</strong>
            <p>
              {status === 'unsupported'
                ? 'Seu navegador não oferece localização. Você ainda pode buscar por cidade acima.'
                : 'Usamos sua localização apenas para mostrar empresas que atendem sua região.'}
            </p>
          </div>
          {status === 'idle' ? (
            <button type="button" className="home-button home-button--secondary" onClick={onRequestLocation}>
              Usar minha localização
              <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {status === 'loading' ? <p className="home-nearby__status" role="status">Buscando empresas próximas…</p> : null}
      {status === 'denied' ? (
        <div className="home-nearby__status" role="status">
          <span>Não conseguimos acessar sua localização. Você ainda pode buscar por cidade acima.</span>
          <button type="button" onClick={onRequestLocation}>Tentar novamente</button>
        </div>
      ) : null}
      {status === 'granted' && nearby.length ? (
        <>
          <p className="home-nearby__distance-note">Ordenadas pela distância aproximada.</p>
          <BusinessCarousel businesses={nearby.map(({ business }) => business)} ariaLabel="empresas próximas" />
        </>
      ) : null}
      {status === 'granted' && !nearby.length ? (
        <p className="home-nearby__status" role="status">Nenhuma empresa com entrega atende sua localização.</p>
      ) : null}

      {status === 'granted' && nearby.length ? (
        <div className="sr-only" aria-live="polite">
          {nearby.map(({ business, distance }) => `${business.name}, ${formatDistance(distance)}`).join('. ')}
        </div>
      ) : null}
    </section>
  );
}
