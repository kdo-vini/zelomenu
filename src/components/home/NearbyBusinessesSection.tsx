import { useMemo, useState } from 'react';
import { ArrowRight, LocateFixed, MapPin } from 'lucide-react';
import type { Business } from '../../data/types.ts';
import { BusinessCarousel } from './BusinessCarousel.tsx';

interface NearbyBusinessesSectionProps {
  businesses: Business[];
}

type Coordinates = { latitude: number; longitude: number };

function distanceInKm(from: Coordinates, to: Coordinates): number {
  const earthRadius = 6371;
  const latDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const lngDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(from.latitude * Math.PI / 180) * Math.cos(to.latitude * Math.PI / 180) * Math.sin(lngDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distanceKm: number): string {
  return distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1).replace('.', ',')} km`;
}

export function NearbyBusinessesSection({ businesses }: NearbyBusinessesSectionProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);

  const nearby = useMemo(() => {
    if (!coordinates) return [];
    return businesses
      .filter((business) => business.latitude != null && business.longitude != null)
      .map((business) => ({ business, distance: distanceInKm(coordinates, { latitude: business.latitude!, longitude: business.longitude! }) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);
  }, [businesses, coordinates]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setStatus('denied');
      return;
    }
    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setStatus('granted');
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  }

  return (
    <section className="home-section home-nearby" aria-labelledby="nearby-businesses-title">
      <div className="home-section-header">
        <div>
          <h2 id="nearby-businesses-title">Perto de você</h2>
          <p>Encontre empresas da sua região sem precisar informar o endereço.</p>
        </div>
        <MapPin size={22} aria-hidden="true" />
      </div>

      {status === 'idle' ? (
        <div className="home-nearby__prompt">
          <div className="home-nearby__prompt-icon"><LocateFixed size={22} aria-hidden="true" /></div>
          <div>
            <strong>Mostre opções próximas</strong>
            <p>Usamos sua localização apenas para ordenar as empresas ao seu redor.</p>
          </div>
          <button type="button" className="home-button home-button--secondary" onClick={requestLocation}>
            Usar minha localização
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {status === 'loading' ? <p className="home-nearby__status" role="status">Buscando empresas próximas…</p> : null}
      {status === 'denied' ? (
        <div className="home-nearby__status" role="status">
          <span>Não conseguimos acessar sua localização. Você ainda pode buscar por cidade acima.</span>
          <button type="button" onClick={requestLocation}>Tentar novamente</button>
        </div>
      ) : null}
      {status === 'granted' && nearby.length ? (
        <>
          <p className="home-nearby__distance-note">Ordenadas pela distância aproximada.</p>
          <BusinessCarousel businesses={nearby.map(({ business }) => business)} ariaLabel="empresas próximas" />
        </>
      ) : null}
      {status === 'granted' && !nearby.length ? (
        <p className="home-nearby__status" role="status">Ainda não há empresas com localização cadastrada nesta região.</p>
      ) : null}

      {status === 'granted' && nearby.length ? (
        <div className="sr-only" aria-live="polite">
          {nearby.map(({ business, distance }) => `${business.name}, ${formatDistance(distance)}`).join('. ')}
        </div>
      ) : null}
    </section>
  );
}
