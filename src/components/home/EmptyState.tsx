import { Search } from 'lucide-react';

interface EmptyStateProps {
  onClear: () => void;
}

export function EmptyState({ onClear }: EmptyStateProps) {
  return (
    <div className="home-empty-state" role="status">
      <div className="home-empty-state__icon">
        <Search size={28} strokeWidth={1.5} />
      </div>
      <h3>Nenhuma empresa encontrada</h3>
      <p>Tente buscar outro nome, categoria ou cidade.</p>
      <button className="home-button home-button--secondary" type="button" onClick={onClear}>
        Limpar filtros
      </button>
    </div>
  );
}
