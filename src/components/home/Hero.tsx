import { Sparkles } from 'lucide-react';
import { SearchBar } from './SearchBar.tsx';

interface HeroProps {
  query: string;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onSearch: () => void;
}

export function Hero({ query, onQueryChange, onClearQuery, onSearch }: HeroProps) {
  return (
    <section className="home-hero" aria-labelledby="home-hero-title">
      <div className="home-container home-hero__grid">
        <div className="home-hero__copy">
          <div className="home-hero__eyebrow">
            <Sparkles size={15} strokeWidth={2.5} />
            O ecossistema que conecta você a negócios locais
          </div>
          <h1 id="home-hero-title">
            Seu próximo pedido <span>começa aqui</span>.
          </h1>
          <p>
            Cardápios digitais, pedidos online e acompanhamento em tempo real — tudo direto dos seus estabelecimentos favoritos.
          </p>
        </div>

        <div className="home-hero__art" aria-hidden="true">
          <div className="home-hero__glow" />
          <picture>
            <source srcSet="/assets/hero/zelomenu-hero-original.webp" type="image/webp" />
            <img
              src="/assets/hero/zelomenu-hero.svg"
              alt=""
              width="940"
              height="1120"
              className="home-hero__img"
              fetchPriority="high"
            />
          </picture>
        </div>

        <div className="home-hero__search">
          <SearchBar
            value={query}
            onChange={onQueryChange}
            onClear={onClearQuery}
            onSubmit={onSearch}
          />
        </div>

        <div className="home-hero__trust" role="group" aria-label="Benefícios do ZeloMenu">
          <span>Cardápios digitais</span>
          <span>Pedidos online</span>
          <span>Destaques das empresas</span>
          <span>Acompanhe seu pedido</span>
        </div>
      </div>
    </section>
  );
}
