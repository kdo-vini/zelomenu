import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { getMesaContext, type MesaContextResponse } from '../services/zelomenuApi';
import { ZeloMenuStorePage } from './ZeloMenuStorePage';

export function ZeloMenuMesaPage() {
  const { slug, mesaId } = useParams<{ slug: string; mesaId: string }>();
  const [mesaCtx, setMesaCtx] = useState<MesaContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!slug || !mesaId) return;
    setLoading(true);
    setFetchError(false);
    getMesaContext(slug, mesaId)
      .then(setMesaCtx)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [slug, mesaId, retryKey]);

  if (!slug || !mesaId) return null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-gray-400">Carregando...</span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center" role="alert">
          <p className="text-center text-sm text-gray-500">
            Não consegui verificar a mesa. Tente novamente.
          </p>
          <button
            type="button"
            onClick={() => setRetryKey((key) => key + 1)}
            className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar novamente
          </button>
        </div>
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
