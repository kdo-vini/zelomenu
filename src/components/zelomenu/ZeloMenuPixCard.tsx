import { useEffect, useState } from 'react';
import { Check, Loader2, QrCode } from 'lucide-react';
import {
  getZeloMenuSettings,
  updateZeloMenuSettings,
  type PixKeyType,
} from '../../services/zelomenuAdminApi';
import { isValidPixKeyForType } from '../../domain/pixBrCode';

const PIX_KEY_TYPE_OPTIONS: Array<{ value: PixKeyType; label: string; placeholder: string }> = [
  { value: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
  { value: 'phone', label: 'Celular', placeholder: '(11) 91234-5678' },
  { value: 'email', label: 'E-mail', placeholder: 'loja@exemplo.com' },
  { value: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00' },
  { value: 'random', label: 'Aleatória', placeholder: 'Chave aleatória (UUID)' },
];

export function ZeloMenuPixCard() {
  const [loading, setLoading] = useState(true);
  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState<PixKeyType | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await getZeloMenuSettings();
        if (!active) return;
        setPixKey(s.pixKey ?? '');
        setPixKeyType(s.pixKeyType);
      } catch {
        // silent
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const trimmed = pixKey.trim();
  const invalid = trimmed !== '' && (!pixKeyType || !isValidPixKeyForType(trimmed, pixKeyType));

  async function save() {
    if (invalid) return;
    try {
      setSaving(true);
      setError(null);
      await updateZeloMenuSettings({
        pixKey: trimmed || null,
        pixKeyType: trimmed ? pixKeyType : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-4">
        <QrCode className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
        <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">Pagamento via Pix</h3>
      </div>
      <div className="p-5">
        <div className="space-y-6">
          <p className="text-[12px] text-[var(--color-ink-muted)]">
            Gera o código Pix Copia e Cola com o valor do pedido, na tela de confirmação do cliente.
          </p>

          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Tipo de chave</p>
              <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--color-canvas)] p-1">
                {PIX_KEY_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPixKeyType(opt.value)}
                    className={`flex h-11 min-w-[64px] flex-1 items-center justify-center rounded-lg px-2 text-[12px] font-semibold transition ${
                      pixKeyType === opt.value
                        ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm'
                        : 'text-[var(--color-ink-muted)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Chave Pix</p>
              <input
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                placeholder={PIX_KEY_TYPE_OPTIONS.find((opt) => opt.value === pixKeyType)?.placeholder ?? 'Escolha o tipo de chave acima'}
                className={`h-11 w-full rounded-xl border bg-[var(--color-canvas)] px-4 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)] ${
                  invalid ? 'border-[var(--color-alert)]' : 'border-[var(--color-line)]'
                }`}
                style={{ transition: 'border-color 0.15s' }}
              />
              {invalid ? (
                <p className="mt-1 text-[11.5px] text-[var(--color-alert)]">
                  {pixKeyType
                    ? 'Essa chave não parece válida para o tipo selecionado. Confira e tente de novo.'
                    : 'Escolha o tipo da chave acima antes de salvar.'}
                </p>
              ) : (
                <p className="mt-1 text-[11.5px] text-[var(--color-ink-muted)]">
                  Mesma chave usada no ZeloChat para conferir comprovantes. Deixe em branco para não gerar o Pix Copia e Cola.
                </p>
              )}
            </div>
          </div>

          {error ? <p className="text-[12.5px] text-[var(--color-alert)]">{error}</p> : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || invalid}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--color-brand)' }}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : saved ? (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            ) : null}
            {saving ? 'Salvando…' : saved ? 'Salvo!' : 'Salvar chave Pix'}
          </button>
        </div>
      </div>
    </div>
  );
}
