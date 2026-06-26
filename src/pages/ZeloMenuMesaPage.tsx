import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getMesaContext, type MesaContextResponse } from '../services/zelomenuApi';
import { ZeloMenuStorePage } from './ZeloMenuStorePage';

export function ZeloMenuMesaPage() {
  const { slug, mesaId } = useParams<{ slug: string; mesaId: string }>();
  const [mesaCtx, setMesaCtx] = useState<MesaContextResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug || !mesaId) return;
    getMesaContext(slug, mesaId)
      .then(setMesaCtx)
      .finally(() => setLoading(false));
  }, [slug, mesaId]);

  if (!slug || !mesaId) return null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-400">Carregando...</span>
      </div>
    );
  }

  const hasCarta = mesaCtx != null && !mesaCtx.error;

  return (
    <ZeloMenuStorePage
      slug={slug}
      mesaBanner={hasCarta ? `Mesa ${mesaCtx.mesa_numero}` : undefined}
      mesaUnavailableMessage={
        !hasCarta
          ? mesaCtx?.error === 'MESA_NOT_FOUND'
            ? 'Mesa não encontrada.'
            : 'Aguardando atendimento. Peça ao garçom para abrir sua comanda.'
          : undefined
      }
      tableOrderContext={
        hasCarta
          ? { mesa_id: mesaId, comanda_id: mesaCtx.comanda_id! }
          : undefined
      }
    />
  );
}
