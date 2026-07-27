export function BusinessGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="home-business-grid" aria-label="Carregando empresas" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="home-business-card home-business-card--skeleton" key={index} aria-hidden="true">
          <div className="home-skeleton home-skeleton--cover" />
          <div className="home-business-card__body">
            <div className="home-skeleton home-skeleton--title" />
            <div className="home-skeleton home-skeleton--line" />
            <div className="home-skeleton home-skeleton--button" />
          </div>
        </div>
      ))}
    </div>
  );
}
