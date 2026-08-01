import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronDown, CircleAlert, Loader2 } from 'lucide-react';
import { buildZeloMenuPublicUrl, getZeloMenuSettings, getZeloMenuSlug, type ZeloMenuStoreSettings } from '../../services/zelomenuAdminApi';

const READINESS_STORAGE_KEY = 'zelomenu:publication-readiness:expanded';

type ReadinessItem = {
  id: string;
  title: string;
  description: string;
  ready: boolean;
  href: string;
  action: string;
};

function hasConfiguredHours(settings: ZeloMenuStoreSettings): boolean {
  return Object.values(settings.weeklyHours).some((windows) => windows.length > 0);
}

export function buildReadinessItems(settings: ZeloMenuStoreSettings, slug: string | null): ReadinessItem[] {
  const summary = settings.publicationSummary;
  return [
    {
      id: 'link',
      title: 'Link público definido',
      description: slug ? `Seu cardápio está em ${buildZeloMenuPublicUrl(slug)}.` : 'Escolha o endereço que você vai compartilhar com seus clientes.',
      ready: Boolean(slug),
      href: '#settings/admin',
      action: slug ? 'Gerenciar' : 'Configurar',
    },
    {
      id: 'products',
      title: 'Pelo menos um produto publicado',
      description: summary.published > 0 ? `${summary.published} de ${summary.total} produto${summary.total === 1 ? '' : 's'} aparece${summary.published === 1 ? '' : 'm'} no cardápio.` : 'Publique um produto para o cliente encontrar algo no link.',
      ready: summary.published > 0,
      href: '#catalog',
      action: 'Ver catálogo',
    },
    {
      id: 'catalog',
      title: 'Catálogo sem pendências',
      description: summary.attention === 0 ? 'Produtos publicados, organizados e disponíveis.' : `${summary.attention} produto${summary.attention === 1 ? '' : 's'} precisa${summary.attention === 1 ? '' : 'm'} de atenção antes de vender.`,
      ready: summary.total > 0 && summary.attention === 0,
      href: '#catalog',
      action: 'Revisar itens',
    },
    {
      id: 'visual',
      title: 'Identidade da loja preenchida',
      description: settings.logoUrl || settings.coverUrl || settings.description ? 'Logo, capa ou descrição já aparecem na vitrine.' : 'Adicione uma imagem ou uma descrição para a vitrine transmitir confiança.',
      ready: Boolean(settings.logoUrl || settings.coverUrl || settings.description),
      href: '#publication',
      action: 'Editar visual',
    },
    {
      id: 'hours',
      title: 'Horários de atendimento definidos',
      description: hasConfiguredHours(settings) ? 'O cliente verá quando a loja está aberta e poderá agendar dentro das regras.' : 'Defina os horários para evitar pedidos fora da operação.',
      ready: hasConfiguredHours(settings),
      href: '#settings/horarios',
      action: 'Editar horários',
    },
  ];
}

export function ZeloMenuReadinessCard() {
  const [settings, setSettings] = useState<ZeloMenuStoreSettings | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const storageKey = `${READINESS_STORAGE_KEY}:${slug || 'sem-link'}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === 'true' || saved === 'false') setExpanded(saved === 'true');
    } catch {
      // Prefer the compact default when local storage is unavailable.
    }
  }, [storageKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [nextSettings, nextSlug] = await Promise.all([getZeloMenuSettings(), getZeloMenuSlug()]);
      setSettings(nextSettings);
      setSlug(nextSlug.slug);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5" aria-busy="true">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-brand)]" />
          Conferindo a prontidão do cardápio…
        </div>
      </section>
    );
  }

  if (error || !settings) {
    return (
      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Não consegui verificar a prontidão agora.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-11 rounded-xl border border-[var(--color-line-strong)] px-3 text-sm font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]"
          >
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  const items = buildReadinessItems(settings, slug);
  const readyCount = items.filter((item) => item.ready).length;
  const allReady = readyCount === items.length;

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // The UI still works for private browsing or disabled storage.
      }
      return next;
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-expanded={expanded}
        aria-controls="zelomenu-readiness-details"
        className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]/35 sm:px-6"
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${allReady ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'}`}>
          {allReady ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <CircleAlert className="h-4 w-4" strokeWidth={2} />}
        </span>
        <span className="min-w-0 flex-1 text-sm font-bold text-[var(--color-ink)]">
          Pronto para compartilhar?
          <span className={`ml-1 font-medium ${allReady ? 'text-[var(--color-success)]' : 'text-[var(--color-ink-muted)]'}`}>
            · {allReady ? 'Tudo concluído' : `${readyCount}/${items.length} concluídos`}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--color-ink-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {expanded && (
        <div id="zelomenu-readiness-details" className="border-t border-[var(--color-line)]">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 sm:px-6">
            <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              Uma revisão rápida para evitar que o cliente encontre um cardápio incompleto.
            </p>
            <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-bold ${allReady ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'}`}>
              {readyCount}/{items.length} concluídos
            </span>
          </div>

          <div className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.ready ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]'}`}>
                  {item.ready ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <CircleAlert className="h-3.5 w-3.5" strokeWidth={2} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{item.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{item.description}</p>
                </div>
                <a
                  href={item.href}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-bold text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/30"
                >
                  {item.action}
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
