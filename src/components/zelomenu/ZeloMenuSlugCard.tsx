import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';
import { buildZeloMenuPublicUrl, getZeloMenuSlug, setZeloMenuSlug, ZELOMENU_PUBLIC_HOST } from '../../services/zelomenuAdminApi';

// "Link público do cardápio" card. Self-contained drop-in `<ZeloMenuSlugCard />`
// — the API client reads the Supabase session itself, so no props are required.
//
// Lets the owner pick the slug under menu.zelopdv.com.br/<slug>, save it, and
// copy the full public URL to the clipboard.
export function ZeloMenuSlugCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState('');
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { slug: current } = await getZeloMenuSlug();
        if (!active) return;
        setSlug(current ?? '');
        setSavedSlug(current);
      } catch {
        // silencioso — card mostra spinner e some
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function save() {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      const { slug: persisted } = await setZeloMenuSlug(slug.trim());
      setSlug(persisted);
      setSavedSlug(persisted);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui salvar o link. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!savedSlug) return;
    try {
      await navigator.clipboard.writeText(buildZeloMenuPublicUrl(savedSlug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Não consegui copiar o link.');
    }
  }

  if (loading) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-4">
        <Link2 className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
        <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">Link público do cardápio</h3>
      </div>
      <div className="p-5">
        <div className="space-y-3">
          {/* Prefixed slug input */}
          <div className="flex items-stretch overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-canvas)] focus-within:border-[var(--color-brand)]">
            <span className="flex shrink-0 items-center border-r border-[var(--color-line)] bg-[var(--color-surface-muted)] px-3 text-[13px] text-[var(--color-ink-muted)]">
              {ZELOMENU_PUBLIC_HOST}/
            </span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="meu-cardapio"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)]"
            />
          </div>
          <p className="text-[12px] text-[var(--color-ink-muted)]">
            Use apenas letras minúsculas, números e hifens.
          </p>

          {error ? (
            <p className="text-[12.5px] text-[var(--color-alert)]">{error}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--color-brand)' }}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
              ) : success ? (
                <Check className="h-4 w-4" strokeWidth={2.5} />
              ) : null}
              {saving ? 'Salvando…' : success ? 'Salvo!' : 'Salvar'}
            </button>

            <button
              type="button"
              onClick={() => void copyLink()}
              disabled={!savedSlug}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-4 text-[13px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
            >
              {copied ? (
                <Check className="h-4 w-4 text-[var(--color-brand-deep)]" strokeWidth={2.5} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.8} />
              )}
              {copied ? 'Copiado!' : 'Copiar link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
