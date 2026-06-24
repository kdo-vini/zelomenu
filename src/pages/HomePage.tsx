import { Link } from 'react-router-dom';
import { NeutralState } from '../components/NeutralState';

// Placeholder landing for `/`. The product surface for this app is the owner
// config at `/admin`; the public menu runtime will come in a later wave.
export function HomePage() {
  return (
    <NeutralState
      title="ZeloMenu"
      description="Configuração do cardápio do ZeloMenu."
    >
      <Link
        to="/admin"
        className="inline-flex items-center justify-center rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1EBE5D]"
      >
        Abrir configuração
      </Link>
    </NeutralState>
  );
}
