import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, CircleHelp, ExternalLink, MessageCircle, Search } from 'lucide-react';
import { FAQ_CATEGORIES, FAQ_ENTRIES, searchFaqEntries, type FaqCategory, type FaqEntry } from '../data/supportFaq';
import { buildSupportWhatsAppLink } from '../domain/support';

type Impact = 'Tenho uma dúvida' | 'Não consigo concluir uma tarefa' | 'O problema está afetando meus clientes';

export function SupportPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FaqCategory | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const [triageEntry, setTriageEntry] = useState<FaqEntry | null>(null);
  const [impact, setImpact] = useState<Impact>('Tenho uma dúvida');
  const [message, setMessage] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [sent, setSent] = useState(false);

  const visibleEntries = useMemo(() => searchFaqEntries(FAQ_ENTRIES, query, category), [category, query]);

  const triageHref = message.trim().length >= 20
    ? buildSupportWhatsAppLink({
        topic: triageEntry?.question ?? 'Dúvida geral',
        impact,
        screen: 'Ajuda e suporte',
        faqQuestion: triageEntry?.question,
        businessName,
        message,
      })
    : null;

  const startTriage = (entry: FaqEntry | null) => {
    setTriageOpen(true);
    setTriageEntry(entry);
    setSent(false);
    setMessage('');
    setBusinessName('');
    setImpact('Tenho uma dúvida');
    window.setTimeout(() => document.getElementById('support-triage')?.focus(), 0);
  };

  const handleNavigate = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-10 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-9">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
          <CircleHelp className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-[var(--color-ink)]">Ajuda e suporte</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Encontre uma resposta rápida ou explique o que aconteceu para falar com nosso suporte.
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 sm:p-6" aria-labelledby="support-search-title">
        <div className="max-w-2xl">
          <h2 id="support-search-title" className="text-base font-bold text-[var(--color-ink)]">O que você precisa resolver?</h2>
          <label className="relative mt-3 block">
            <span className="sr-only">Buscar ajuda</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--color-ink-muted)]" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ex.: como mudar o preço?"
              className="min-h-12 w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-muted)] pl-10 pr-4 text-base text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/30"
            />
          </label>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Temas de ajuda">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 ${
              category === null
                ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            Tudo
          </button>
          {FAQ_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 ${
                category === item.id
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                  : 'border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="support-faq-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 id="support-faq-title" className="text-lg font-bold text-[var(--color-ink)]">Respostas rápidas</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {query ? `${visibleEntries.length} resposta${visibleEntries.length === 1 ? '' : 's'} encontrada${visibleEntries.length === 1 ? '' : 's'}.` : 'Escolha uma resposta ou pesquise por uma tarefa.'}
            </p>
          </div>
          {!triageEntry && (
            <button
              type="button"
              onClick={() => startTriage(null)}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
            >
              Não encontrei
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {visibleEntries.length > 0 ? (
          <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]">
            {visibleEntries.map((entry) => {
              const open = openId === entry.id;
              const resolved = resolvedId === entry.id;
              return (
                <article key={entry.id}>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`faq-answer-${entry.id}`}
                    onClick={() => setOpenId(open ? null : entry.id)}
                    className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]/40 sm:px-5"
                  >
                    <span className="text-sm font-semibold leading-5 text-[var(--color-ink)]">{entry.question}</span>
                    <ChevronDown className={`h-5 w-5 shrink-0 text-[var(--color-ink-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {open && (
                    <div id={`faq-answer-${entry.id}`} role="region" className="border-t border-[var(--color-line)] px-4 pb-4 pt-3 sm:px-5">
                      <p className="max-w-3xl text-sm leading-6 text-[var(--color-ink-soft)]">{entry.answer}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {entry.action && (
                          <button
                            type="button"
                            onClick={() => handleNavigate(entry.action!.hash)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
                          >
                            {entry.action.label}
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setResolvedId(entry.id)}
                          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 ${resolved ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]' : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]'}`}
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          {resolved ? 'Resolvido' : 'Isso resolveu'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startTriage(entry)}
                          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
                        >
                          Ainda preciso de ajuda
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] p-6 text-center">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Não encontrei uma resposta para essa busca.</p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Explique o que aconteceu e encaminhe a dúvida para o suporte.</p>
            <button
              type="button"
              onClick={() => startTriage(null)}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
            >
              Falar com o suporte
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {triageOpen ? (
        <section id="support-triage" tabIndex={-1} aria-labelledby="support-triage-title" className="scroll-mt-4 rounded-2xl border border-[var(--color-brand-soft)] bg-[var(--color-brand-soft)]/35 p-4 outline-none sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface)] text-[var(--color-brand-deep)]">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 id="support-triage-title" className="text-base font-bold text-[var(--color-ink)]">Vamos encaminhar sua dúvida</h2>
                <p className="mt-1 text-sm leading-5 text-[var(--color-ink-soft)]">
                  O FAQ não resolveu? Conte o contexto para o suporte responder mais rápido.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTriageOpen(false)}
              className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
            >
              Voltar ao FAQ
            </button>
          </div>

          {sent ? (
            <div className="mt-5 flex items-start gap-3 rounded-xl bg-[var(--color-success-soft)] p-4 text-[var(--color-success)]">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="text-sm font-semibold">Mensagem preparada. Revise e envie pelo WhatsApp para concluir o atendimento.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-[var(--color-ink)]">O que melhor descreve o caso?</span>
                <select
                  value={impact}
                  onChange={(event) => setImpact(event.target.value as Impact)}
                  className="min-h-12 w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/30"
                >
                  <option>Tenho uma dúvida</option>
                  <option>Não consigo concluir uma tarefa</option>
                  <option>O problema está afetando meus clientes</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-semibold text-[var(--color-ink)]">Nome do estabelecimento <span className="font-normal text-[var(--color-ink-muted)]">(opcional)</span></span>
                <input
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  placeholder="Ex.: Bistrô da Vila"
                  className="min-h-12 w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/30"
                />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="text-sm font-semibold text-[var(--color-ink)]">Explique o que aconteceu</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  minLength={20}
                  rows={4}
                  placeholder="Informe a tarefa, o produto ou a mensagem que apareceu."
                  className="w-full resize-y rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-3 text-base leading-6 text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/30"
                />
                <span className="text-xs text-[var(--color-ink-muted)]">Mínimo de 20 caracteres para o suporte entender o contexto.</span>
              </label>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  disabled={!triageHref}
                  onClick={() => {
                    if (!triageHref) return;
                    setSent(true);
                    window.open(triageHref, '_blank', 'noopener,noreferrer');
                  }}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-brand-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Continuar no WhatsApp
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="text-xs leading-5 text-[var(--color-ink-muted)]">O WhatsApp abrirá uma mensagem pronta; você revisa e envia.</span>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
