import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Business } from '../../data/types.ts';
import { BusinessCard } from './BusinessCard.tsx';

interface BusinessCarouselProps {
  businesses: Business[];
  priorityCount?: number;
  ariaLabel?: string;
}

export function BusinessCarousel({
  businesses,
  priorityCount = 0,
  ariaLabel = 'Empresas',
}: BusinessCarouselProps) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const syncCarouselControls = useCallback(() => {
    const element = carouselRef.current;
    if (!element) return;

    setCanScrollPrevious(element.scrollLeft > 4);
    setCanScrollNext(element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncCarouselControls();
    const element = carouselRef.current;
    if (!element) return undefined;

    element.addEventListener('scroll', syncCarouselControls, { passive: true });
    window.addEventListener('resize', syncCarouselControls);

    return () => {
      element.removeEventListener('scroll', syncCarouselControls);
      window.removeEventListener('resize', syncCarouselControls);
    };
  }, [businesses.length, syncCarouselControls]);

  function moveCarousel(direction: -1 | 1) {
    const element = carouselRef.current;
    if (!element) return;

    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    element.scrollBy({
      left: direction * Math.max(320, element.clientWidth * 0.78),
      behavior,
    });
  }

  if (businesses.length === 0) return null;

  return (
    <div className="home-business-carousel">
      <div className="home-business-carousel__controls" aria-label={`Navegar por ${ariaLabel.toLowerCase()}`}>
        <button
          type="button"
          className="home-business-carousel__control"
          onClick={() => moveCarousel(-1)}
          disabled={!canScrollPrevious}
          aria-label={`Ver ${ariaLabel.toLowerCase()} anteriores`}
        >
          <ArrowLeft size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="home-business-carousel__control"
          onClick={() => moveCarousel(1)}
          disabled={!canScrollNext}
          aria-label={`Ver ${ariaLabel.toLowerCase()} seguintes`}
        >
          <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <div ref={carouselRef} className="home-business-carousel__track" aria-label={ariaLabel}>
        {businesses.map((business, index) => (
          <BusinessCard key={business.id} business={business} priority={index < priorityCount} />
        ))}
      </div>
    </div>
  );
}
