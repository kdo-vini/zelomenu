import { Clock, ExternalLink, Loader2, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { DeliveryHealthStatus, DeliveryQuoteRequestDetail, DeliveryQuoteRequestSummary } from '../../services/zelomenuAdminApi';
import {
  cancelDeliveryQuoteRequest,
  expireDeliveryQuoteRequests,
  getDeliveryHealth,
  getDeliveryQuoteRequestDetail,
  listPendingDeliveryQuoteRequests,
  resolveDeliveryQuoteRequest,
  retryDeliveryQuoteRequest,
} from '../../services/zelomenuAdminApi';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function reasonLabel(code: string): string {
  const map: Record<string, string> = {
    provider_timeout: 'Provedor de rota indisponível',
    provider_unavailable: 'Provedor de rota fora do ar',
    geocoding_failed: 'Falha ao localizar endereço',
    cep_invalid: 'CEP inválido',
    store_not_ready: 'Loja sem configuração',
    address_invalid: 'Endereço inválido',
    out_of_area: 'Fora da área de entrega',
    all_providers_failed: 'Todos os provedores falharam',
    internal_error: 'Erro interno',
    cancelled_by_operator: 'Cancelado pelo operador',
  };
  return map[code] ?? code;
}

export function DeliveryQuoteQueue() {
  const [requests, setRequests] = useState<DeliveryQuoteRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [health, setHealth] = useState<DeliveryHealthStatus | null>(null);
  const [detail, setDetail] = useState<DeliveryQuoteRequestDetail | null>(null);
  const [resolveFee, setResolveFee] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPendingDeliveryQuoteRequests();
      setRequests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar fila');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchRequests(); }, [fetchRequests]);

  async function handleRetry(id: string) {
    setActionLoading(id);
    setError(null);
    try {
      const result = await retryDeliveryQuoteRequest(id);
      if (result.ok) {
        await fetchRequests();
      } else {
        setError('Recálculo não foi possível. A solicitação permanece pendente.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao recalcular');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResolve(id: string) {
    const fee = Number(resolveFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError('Informe um valor de frete válido.');
      return;
    }
    setActionLoading(id);
    setError(null);
    try {
      await resolveDeliveryQuoteRequest(id, fee);
      setResolvingId(null);
      setResolveFee('');
      await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao resolver');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm('Tem certeza que deseja cancelar esta solicitação?')) return;
    setActionLoading(id);
    setError(null);
    try {
      await cancelDeliveryQuoteRequest(id);
      await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar');
    } finally {
      setActionLoading(null);
    }
  }

  async function openDetail(id: string) {
    setDetail(null);
    try {
      const data = await getDeliveryQuoteRequestDetail(id);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar detalhes');
    }
  }

  async function handleCleanup() {
    setError(null);
    try {
      const result = await expireDeliveryQuoteRequests();
      if (result.expired > 0) await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao limpar expirados');
    }
  }

  async function checkHealth() {
    try {
      const h = await getDeliveryHealth();
      setHealth(h);
    } catch { setHealth(null); }
  }

  const age = (createdAt: string): string => {
    const diff = Date.now() - new Date(createdAt).getTime();
    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    if (hours > 0) return `${hours}h${minutes}m`;
    return `${minutes}min`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-ink)]">Solicitações pendentes</h3>
          <p className="text-[11px] text-[var(--color-ink-muted)]">
            Pedidos que não puderam ser calculados automaticamente.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void checkHealth()}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)]"
            title="Verificar saúde dos provedores"
          >
            <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => void handleCleanup()}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)]"
            title="Limpar solicitações expiradas"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => void fetchRequests()}
            disabled={loading}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-[11px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
            Atualizar
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] px-3 py-2 text-[11px] text-[var(--color-warn)]" role="status">
          {error}
        </p>
      )}

      {health && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-2.5 text-[11px]">
          <span className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${health.supabase === 'ok' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-alert)]'}`} />
            Supabase
          </span>
          {Object.entries(health.circuits).map(([provider, circuit]) => (
            <span key={provider} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${
                circuit.state === 'closed' ? 'bg-[var(--color-success)]'
                : circuit.state === 'half-open' ? 'bg-[var(--color-warn)]'
                : 'bg-[var(--color-alert)]'
              }`} />
              {provider}
              {circuit.state !== 'closed' && <span className="text-[10px] text-[var(--color-ink-faint)]">({circuit.failures} falhas)</span>}
            </span>
          ))}
          <span className="text-[var(--color-ink-faint)]">·</span>
          <span>{health.pendingRequests} pendentes</span>
          {health.oldestPendingMs != null && (
            <span className="text-[var(--color-ink-faint)]">· mais antigo há {Math.round(health.oldestPendingMs / 60000)}min</span>
          )}
        </div>
      )}

      {loading && requests.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-ink-soft)]" />
        </div>
      )}

      {!loading && requests.length === 0 && (
        <p className="py-6 text-center text-[13px] text-[var(--color-ink-faint)]">
          Nenhuma solicitação pendente.
        </p>
      )}

      {requests.length > 0 && (
        <div className="space-y-2">
          {requests.map((req) => (
            <div key={req.id} className="rounded-xl border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)]/30 p-3 text-[13px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 text-[var(--color-ink)]">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" strokeWidth={1.8} />
                    <span className="font-semibold">{reasonLabel(req.reasonCode)}</span>
                    <span className="text-[11px] text-[var(--color-ink-faint)]">há {age(req.createdAt)}</span>
                  </div>
                  <div className="text-[11px] text-[var(--color-ink-soft)]">
                    Protocolo: <code className="rounded bg-[var(--color-surface-muted)] px-1 font-mono text-[10px]">{req.idempotencyKey}</code>
                    {' · '}Criado em {formatDate(req.createdAt)}
                  </div>
                  <div className="text-[11px] text-[var(--color-ink-faint)]">
                    Expira em {formatDate(req.expiresAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void openDetail(req.id)}
                  className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)]"
                  title="Ver detalhes"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleRetry(req.id)}
                  disabled={actionLoading === req.id}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--color-brand)] px-2.5 text-[11px] font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] disabled:opacity-60"
                >
                  {actionLoading === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" strokeWidth={1.8} />}
                  Recalcular
                </button>
                {resolvingId === req.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={resolveFee}
                      onChange={(e) => setResolveFee(e.target.value)}
                      placeholder="R$ 0,00"
                      className="h-8 w-24 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-[var(--color-ink)] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleResolve(req.id)}
                      disabled={actionLoading === req.id}
                      className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-[var(--color-success)] px-2.5 text-[11px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
                    >
                      {actionLoading === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => { setResolvingId(null); setResolveFee(''); }}
                      className="inline-flex min-h-8 items-center rounded-lg px-2 text-[11px] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setResolvingId(req.id)}
                    disabled={actionLoading === req.id}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-60"
                  >
                    Resolver manual
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleCancel(req.id)}
                  disabled={actionLoading === req.id}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold text-[var(--color-alert)] transition-colors hover:bg-[var(--color-alert-soft)] disabled:opacity-60"
                >
                  <XCircle className="h-3 w-3" strokeWidth={1.8} />
                  Cancelar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-[var(--color-canvas)] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[var(--color-line)] p-4">
              <h4 className="text-sm font-bold text-[var(--color-ink)]">Detalhes da solicitação</h4>
              <p className="text-[11px] text-[var(--color-ink-soft)]">Protocolo: {detail.idempotencyKey}</p>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 text-[13px]">
              <div>
                <span className="text-[11px] font-bold text-[var(--color-ink-soft)]">Status</span>
                <p className="mt-0.5 text-[var(--color-ink)]">{detail.status}</p>
              </div>
              <div>
                <span className="text-[11px] font-bold text-[var(--color-ink-soft)]">Motivo</span>
                <p className="mt-0.5 text-[var(--color-ink)]">{reasonLabel(detail.reasonCode)}</p>
              </div>
              <div>
                <span className="text-[11px] font-bold text-[var(--color-ink-soft)]">Criado em</span>
                <p className="mt-0.5 text-[var(--color-ink)]">{formatDate(detail.createdAt)}</p>
              </div>
              <div>
                <span className="text-[11px] font-bold text-[var(--color-ink-soft)]">Expira em</span>
                <p className="mt-0.5 text-[var(--color-ink)]">{formatDate(detail.expiresAt)}</p>
              </div>
              {detail.resolvedFee != null && (
                <div>
                  <span className="text-[11px] font-bold text-[var(--color-ink-soft)]">Frete resolvido</span>
                  <p className="mt-0.5 text-[var(--color-ink)]">R$ {detail.resolvedFee.toFixed(2)}</p>
                </div>
              )}
              {!!detail.lastError && (
                <div>
                  <span className="text-[11px] font-bold text-[var(--color-ink-soft)]">Último erro</span>
                  <pre className="mt-0.5 overflow-x-auto rounded-lg bg-[var(--color-surface-muted)] p-2 text-[10px] text-[var(--color-ink-soft)]">
                    {String(JSON.stringify(detail.lastError, null, 2))}
                  </pre>
                </div>
              )}
              <div>
                <span className="text-[11px] font-bold text-[var(--color-ink-soft)]">Snapshot do carrinho</span>
                <pre className="mt-0.5 max-h-40 overflow-y-auto rounded-lg bg-[var(--color-surface-muted)] p-2 text-[10px] text-[var(--color-ink-soft)]">
                  {String(JSON.stringify(detail.cart, null, 2))}
                </pre>
              </div>
            </div>
            <div className="border-t border-[var(--color-line)] p-3">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="w-full rounded-xl bg-[var(--color-surface-muted)] py-2.5 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-line)]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
