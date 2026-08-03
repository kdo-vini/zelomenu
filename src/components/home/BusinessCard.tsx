import { useBusinessFavorite } from '../../hooks/useHomePersonalization.ts';
import { rememberBusinessVisit } from '../../services/homePersonalization.ts';
import type { Business } from '../../data/types.ts';
import { Heart, MapPin, ArrowRight, Star } from 'lucide-react';
import { optimizedImageUrl } from '../../utils/optimizedImageUrl.ts';

interface BusinessCardProps {
  business: Business;
  priority?: boolean;
}

export function BusinessCard({ business, priority = false }: BusinessCardProps) {
  const location = `${business.city}, ${business.state}`;
  const { favorite, toggle } = useBusinessFavorite(business.id);
  const coverUrl = optimizedImageUrl(business.coverUrl, { width: 640, height: 426 });
  const logoUrl = optimizedImageUrl(business.logoUrl, { width: 96, height: 96 });

  function handleVisit() {
    rememberBusinessVisit(business.id);
  }

  return (
    <article className="home-business-card" data-business-id={business.id}>
      <a className="home-business-card__cover" href={business.menuUrl} onClick={handleVisit} aria-label={`Abrir cardápio de ${business.name}`}>
        {business.coverUrl ? (
          <img
            src={coverUrl ?? business.coverUrl ?? undefined}
            alt={`Foto de capa de ${business.name}`}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            width="900"
            height="600"
            onError={(e) => {
              const image = e.currentTarget;
              if (business.coverUrl && image.dataset.fallback !== 'true' && image.currentSrc !== business.coverUrl) {
                image.dataset.fallback = 'true';
                image.src = business.coverUrl;
                return;
              }
              image.style.display = 'none';
            }}
          />
        ) : <div className="home-business-card__cover-fallback" />}
        {business.sponsored ? <span className="home-business-card__badge">Patrocinado</span> : null}
      </a>

      <button
        type="button"
        className={`home-business-card__favorite${favorite ? ' is-active' : ''}`}
        onClick={toggle}
        aria-pressed={favorite}
        aria-label={favorite ? `Remover ${business.name} dos favoritos` : `Adicionar ${business.name} aos favoritos`}
      >
        <Heart size={18} fill={favorite ? 'currentColor' : 'none'} strokeWidth={2.1} aria-hidden="true" />
      </button>

      <div className="home-business-card__body">
        <div className="home-business-card__identity">
          <img
            src={logoUrl ?? business.logoUrl ?? '/assets/brand/logozelomenu-optimized.png'}
            alt=""
            width="44"
            height="44"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const image = e.currentTarget;
              if (image.dataset.fallback !== 'true') {
                image.dataset.fallback = 'true';
                image.src = business.logoUrl ?? '/assets/brand/logozelomenu-optimized.png';
              } else {
                image.src = '/assets/brand/logozelomenu-optimized.png';
              }
            }}
          />
          <div>
            <h3>{business.name}</h3>
            <p>{business.description || 'Cardápio digital'}</p>
          </div>
        </div>

        <div className="home-business-card__details">
          <span>{business.categoryLabel}</span>
          <span className="home-business-card__rating">
            <Star size={13} fill={business.rating ? 'currentColor' : 'none'} strokeWidth={2} aria-hidden="true" />
            {business.rating ? business.rating.toFixed(1) : 'Sem avaliações'}
          </span>
        </div>

        <div className="home-business-card__location">
          <MapPin size={15} strokeWidth={2} />
          <span>{location}</span>
        </div>

        <a className="home-business-card__button" href={business.menuUrl} onClick={handleVisit}>
          Abrir cardápio
          <ArrowRight size={17} strokeWidth={2.5} />
        </a>
      </div>
    </article>
  );
}
