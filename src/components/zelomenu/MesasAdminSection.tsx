import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode } from 'lucide-react';
import { listMesasAdmin, type MesaRow } from '../../services/zelomenuAdminApi';

interface Props {
  slug: string;
}

// "Mesas & QR Codes" admin card. Lists the store's tables (fetched from the
// admin API) and lets the owner download a QR code PNG for each table.
// Auth is handled by zelomenuAdminApi — no token prop needed.
export function MesasAdminSection({ slug }: Props) {
  const [mesas, setMesas] = useState<MesaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listMesasAdmin();
        if (!active) return;
        setMesas(list);

        const baseUrl = window.location.origin;
        const urls: Record<string, string> = {};
        for (const mesa of list) {
          urls[mesa.id] = await QRCode.toDataURL(
            `${baseUrl}/${slug}/mesa/${mesa.id}`,
            { width: 256, margin: 2 },
          );
        }
        if (active) setQrUrls(urls);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Não consegui carregar as mesas. Tente de novo.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [slug]);

  function downloadQr(mesa: MesaRow) {
    const url = qrUrls[mesa.id];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-mesa-${mesa.numero}.png`;
    a.click();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-4">
        <QrCode className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
        <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">Mesas &amp; QR Codes</h3>
      </div>

      <div className="p-5">
        {loading ? (
          <p className="text-[13px] text-[var(--color-ink-muted)]">Carregando mesas…</p>
        ) : error ? (
          <p className="text-[13px] text-[var(--color-alert)]">{error}</p>
        ) : mesas.length === 0 ? (
          <p className="text-[13px] text-[var(--color-ink-muted)]">
            Nenhuma mesa cadastrada. Gerencie suas mesas no{' '}
            <strong>ZeloPDV → Gestão → Mesas</strong>.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              Baixe os QR codes e cole em cada mesa. O cliente escaneia e faz o
              pedido diretamente pelo cardápio.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {mesas.map((mesa) => (
                <div
                  key={mesa.id}
                  className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-line)] p-4"
                >
                  <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                    Mesa {mesa.numero}
                  </span>
                  {qrUrls[mesa.id] ? (
                    <img
                      src={qrUrls[mesa.id]}
                      alt={`QR Code da Mesa ${mesa.numero}`}
                      className="h-32 w-32"
                    />
                  ) : (
                    <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-[var(--color-canvas)]">
                      <p className="text-[11px] text-[var(--color-ink-muted)]">Gerando…</p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => downloadQr(mesa)}
                    disabled={!qrUrls[mesa.id]}
                    className="mt-1 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--color-brand)' }}
                  >
                    Baixar PNG
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
