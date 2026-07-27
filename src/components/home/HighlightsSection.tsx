import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles, ShoppingBag } from 'lucide-react';
import type { Business } from '../../data/types.ts';

type HighlightsSectionProps = {
  businesses: Business[];
};

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function HighlightsSection({ businesses }: HighlightsSectionProps) {
  const highlights = businesses.flatMap((business) =>
    business.highlights.map((highlight) => ({ business, highlight })),
  );

  const highlightsRef = useRef<HTMLDivElement>(null);
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const syncCarouselControls = useCallback(() => {
    const element = highlightsRef.current;
    if (!element) return;
    setCanScrollPrevious(element.scrollLeft > 4);
    setCanScrollNext(element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
  }, []);

  useEffect(() => {
    syncCarouselControls();
    const element = highlightsRef.current;
    if (!element) return undefined;
    element.addEventListener('scroll', syncCarouselControls, { passive: true });
    window.addEventListener('resize', syncCarouselControls);
    return () => {
      element.removeEventListener('scroll', syncCarouselControls);
      window.removeEventListener('resize', syncCarouselControls);
    };
  }, [highlights.length, syncCarouselControls]);

  function moveCarousel(direction: -1 | 1) {
    const element = highlightsRef.current;
    if (!element) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    element.scrollBy({ left: direction * Math.max(280, element.clientWidth * 0.78), behavior });
  }

  if (highlights.length === 0) return null;

  return (
    <section className="home-section" id="destaques" aria-labelledby="highlights-title">
      <div className="home-section-header home-highlights__header">
        <div>
          <h2>Destaques</h2>
          <p>Escolhas especiais das empresas que já estão no ZeloMenu.</p>
        </div>
        <div className="home-highlights__controls" aria-label="Navegar pelos destaques">
          <button
            type="button"
            className="home-highlights__control"
            onClick={() => moveCarousel(-1)}
            disabled={!canScrollPrevious}
            aria-label="Ver destaques anteriores"
          >
            <ArrowLeft size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="home-highlights__control"
            onClick={() => moveCarousel(1)}
            disabled={!canScrollNext}
            aria-label="Ver próximos destaques"
          >
            <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <h2 id="highlights-title" className="sr-only">Destaques das empresas</h2>

      <div ref={highlightsRef} className="home-highlights" aria-label="Produtos em destaque">
        {highlights.map(({ business, highlight }) => (
          <a
            key={`${business.id}-${highlight.id}`}
            className="home-highlight-card"
            href={`${business.menuUrl}?destaque=${highlight.id}`}
            aria-label={`Adicionar ${highlight.name} ao carrinho de ${business.name}`}
          >
            <div className="home-highlight-card__image">
              {highlight.photoUrl ? (
                <img src={highlight.photoUrl} alt="" width="320" height="220" loading="lazy" />
              ) : (
                <ShoppingBag size={30} strokeWidth={1.5} aria-hidden="true" />
              )}
              <span className="home-highlight-card__badge">
                <Sparkles size={12} strokeWidth={2.4} />
                Destaque
              </span>
            </div>
            <div className="home-highlight-card__body">
              <strong>{highlight.name}</strong>
              <span>{business.name}</span>
              <div className="home-highlight-card__footer">
                <b>{formatPrice(highlight.price)}</b>
                <span>
                  Adicionar
                  <ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" />
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
