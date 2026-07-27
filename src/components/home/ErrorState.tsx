import { HelpCircle } from 'lucide-react';

interface ErrorStateProps {
  onRetry: () => void;
}

export function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <div className="home-empty-state" role="alert">
      <div className="home-empty-state__icon">
        <HelpCircle size={28} strokeWidth={1.5} />
      </div>
      <h3>Não foi possível carregar as empresas</h3>
      <p>Verifique sua conexão e tente novamente.</p>
      <button className="home-button home-button--secondary" type="button" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}
