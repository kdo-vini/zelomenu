import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, Sparkles, UtensilsCrossed } from 'lucide-react';
import {
  generateZeloMenuWelcome,
  getZeloMenuSettings,
  setZeloMenuSlug,
  updateZeloMenuSettings,
} from '../services/zelomenuAdminApi';

export const ONBOARDING_KEY = 'zelomenu_onboarding_v1';
const PUBLIC_HOST = 'menu.zelopdv.com.br';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Step = 0 | 1 | 2 | 3;

interface Props {
  onComplete: () => void;
}

// ─── Step sub-components ───────────────────────────────────────────────────────

function StepWelcome({
  storeName,
  loading,
  onNext,
}: {
  storeName: string;
  loading: boolean;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="w-14 h-14 rounded-2xl bg-[var(--color-brand-soft)] flex items-center justify-center">
          <UtensilsCrossed className="w-6 h-6 text-[var(--color-brand)]" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--color-brand)] mb-2 tracking-wide uppercase">
            ZeloMenu
          </p>
          <h1 id="onboarding-title" className="text-3xl font-bold text-[var(--color-ink)] leading-tight text-balance">
            Vamos configurar{' '}
            {loading ? (
              <span className="inline-block w-36 h-8 bg-[var(--color-line)] rounded-lg align-middle animate-pulse" />
            ) : (
              <span className="text-[var(--color-brand)]">{storeName}</span>
            )}
          </h1>
          <p className="mt-3 text-[var(--color-ink-muted)] text-base leading-relaxed">
            Em menos de 2 minutos seu cardápio digital estará pronto para compartilhar.
          </p>
        </div>
      </div>

      <button
        onClick={onNext}
        className="flex items-center justify-center gap-2 w-full h-14 rounded-2xl bg-[var(--color-brand)] text-white font-semibold text-base transition-all active:scale-[.98]"
      >
        Começar
        <span className="text-lg">→</span>
      </button>
    </div>
  );
}

function StepWelcomeText({
  value,
  onChange,
  onGenerate,
  generating,
  onNext,
  onSkip,
}: {
  value: string;
  onChange: (v: string) => void;
  onGenerate: () => void;
  generating: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 200);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-semibold text-[var(--color-brand)] mb-2 tracking-wide uppercase">
          Passo 1 de 2
        </p>
        <h2 id="onboarding-title" className="text-2xl font-bold text-[var(--color-ink)] leading-tight text-balance">
          Descreva sua loja em uma frase
        </h2>
        <p className="mt-2 text-[var(--color-ink-muted)] text-sm leading-relaxed">
          Esse texto aparece no início do seu cardápio. Você pode mudar depois.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ex: Hambúrgueres artesanais feitos com ingredientes frescos, desde 2018."
          rows={4}
          maxLength={400}
          className="w-full rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-4 py-3.5 text-[var(--color-ink)] text-base sm:text-sm placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-brand)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 resize-none leading-relaxed transition-colors"
          style={{ touchAction: 'auto' }}
        />
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="flex items-center justify-center gap-2 h-10 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-soft)] text-sm font-medium transition-all hover:border-[var(--color-brand)] hover:text-[var(--color-brand)] disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {generating ? 'Gerando…' : 'Gerar com IA'}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={onNext}
          className="flex items-center justify-center gap-2 h-14 rounded-2xl bg-[var(--color-brand)] text-white font-semibold text-base transition-all active:scale-[.98]"
        >
          Continuar
        </button>
        <button
          onClick={onSkip}
          className="h-10 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
        >
          Pular por agora
        </button>
      </div>
    </div>
  );
}

function StepSlug({
  value,
  onChange,
  error,
  saving,
  onNext,
  onSkip,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  saving: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  function sanitize(raw: string) {
    return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-');
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-semibold text-[var(--color-brand)] mb-2 tracking-wide uppercase">
          Passo 2 de 2
        </p>
        <h2 id="onboarding-title" className="text-2xl font-bold text-[var(--color-ink)] leading-tight text-balance">
          Qual será o link do seu cardápio?
        </h2>
        <p className="mt-2 text-[var(--color-ink-muted)] text-sm leading-relaxed">
          É o endereço que você vai compartilhar com os clientes.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div
          className={`flex items-center rounded-2xl border bg-[var(--color-surface)] overflow-hidden transition-colors ${
            error ? 'border-[var(--color-alert)]' : 'border-[var(--color-line-strong)] focus-within:border-[var(--color-brand)] focus-within:ring-2 focus-within:ring-[var(--color-brand)]/30'
          }`}
        >
          <span className="pl-4 pr-1 text-[var(--color-ink-faint)] text-sm whitespace-nowrap select-none">
            menu.zelopdv.com.br/
          </span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(sanitize(e.target.value))}
            placeholder="minha-loja"
            maxLength={48}
            className="flex-1 h-14 pr-4 bg-transparent text-[var(--color-ink)] text-base sm:text-sm placeholder:text-[var(--color-ink-faint)] focus:outline-none"
            style={{ touchAction: 'auto' }}
          />
        </div>
        {error && (
          <p className="text-xs text-[var(--color-alert)] px-1">{error}</p>
        )}
        {value && !error && (
          <p className="text-xs text-[var(--color-ink-muted)] px-1 tabular-nums">
            ✓ menu.zelopdv.com.br/{value}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={onNext}
          disabled={saving}
          className="flex items-center justify-center gap-2 h-14 rounded-2xl bg-[var(--color-brand)] text-white font-semibold text-base transition-all active:scale-[.98] disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Finalizar'}
        </button>
        <button
          onClick={onSkip}
          disabled={saving}
          className="h-10 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
        >
          Pular por agora
        </button>
      </div>
    </div>
  );
}

function StepDone({
  slug,
  onComplete,
}: {
  slug: string;
  onComplete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const url = slug ? `https://${PUBLIC_HOST}/${slug}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silencioso
    }
  }

  return (
    <div className="flex flex-col gap-8 items-center text-center">
      <motion.div
        initial={{ scale: prefersReducedMotion ? 1 : 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={prefersReducedMotion ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
        className="w-20 h-20 rounded-full bg-[var(--color-brand)] flex items-center justify-center shadow-lg"
        style={{ boxShadow: '0 8px 32px rgba(11,151,120,0.35)' }}
      >
        <Check className="w-9 h-9 text-white" strokeWidth={2.5} />
      </motion.div>

      <div>
        <h2 id="onboarding-title" className="text-3xl font-bold text-[var(--color-ink)] mb-2">Tudo pronto!</h2>
        <p className="text-[var(--color-ink-muted)] text-base leading-relaxed">
          Seu cardápio está configurado. Agora é só cadastrar os produtos.
        </p>
      </div>

      {url && (
        <button
          onClick={copy}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--color-brand-soft)] border border-[var(--color-brand)]/20 transition-all active:scale-[.98]"
        >
          <span className="flex-1 text-left text-sm font-medium text-[var(--color-brand-deep)] truncate">
            {url}
          </span>
          {copied ? (
            <Check className="w-4 h-4 text-[var(--color-brand)] flex-shrink-0" />
          ) : (
            <Copy className="w-4 h-4 text-[var(--color-brand)] flex-shrink-0" />
          )}
        </button>
      )}

      <div className="flex flex-col gap-3 w-full">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 h-14 rounded-2xl border-2 border-[var(--color-brand)] text-[var(--color-brand)] font-semibold text-base transition-all active:scale-[.98]"
          >
            <ExternalLink className="w-4 h-4" />
            Ver meu cardápio
          </a>
        )}
        <button
          onClick={onComplete}
          className="h-14 rounded-2xl bg-[var(--color-brand)] text-white font-semibold text-base transition-all active:scale-[.98]"
        >
          Ir para o painel
        </button>
      </div>
    </div>
  );
}

// ─── Main wizard ───────────────────────────────────────────────────────────────

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [direction, setDirection] = useState(1);
  const prefersReducedMotion = useReducedMotion();

  // Remote data
  const [storeName, setStoreName] = useState('');
  const [storeSpecialty, setStoreSpecialty] = useState('');
  const [storeCategories, setStoreCategories] = useState<string[]>([]);
  const [loadingName, setLoadingName] = useState(true);

  // Step 1
  const [welcomeText, setWelcomeText] = useState('');
  const [generatingWelcome, setGeneratingWelcome] = useState(false);

  // Step 2
  const [slug, setSlug] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSlug, setSavedSlug] = useState('');

  // Dialog focus management
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  // Swipe detection (native touch — reliable even over inputs)
  const touchX = useRef(0);
  const touchY = useRef(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await getZeloMenuSettings();
        if (!active) return;
        setStoreName(s.companyName || 'sua loja');
        setStoreSpecialty(s.companySpecialty || '');
        setStoreCategories(s.availableCategories || []);
      } catch {
        if (active) setStoreName('sua loja');
      } finally {
        if (active) setLoadingName(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function go(next: Step) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  async function handleWelcomeNext() {
    if (welcomeText.trim()) {
      try {
        await updateZeloMenuSettings({ welcomeText: welcomeText.trim() });
      } catch {
        // silencioso — não bloqueia
      }
    }
    go(2);
  }

  async function handleSlugNext() {
    if (!slug.trim()) {
      go(3);
      return;
    }
    try {
      setSaving(true);
      setSlugError(null);
      const { slug: saved } = await setZeloMenuSlug(slug.trim());
      setSavedSlug(saved);
      go(3);
    } catch (err) {
      setSlugError(err instanceof Error ? err.message : 'Não consegui salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    try {
      setGeneratingWelcome(true);
      const text = await generateZeloMenuWelcome({
        companyName: storeName,
        companySpecialty: storeSpecialty,
        categories: storeCategories,
      });
      setWelcomeText(text);
    } catch {
      // silencioso
    } finally {
      setGeneratingWelcome(false);
    }
  }

  function finish() {
    localStorage.setItem(ONBOARDING_KEY, 'done');
    onComplete();
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
    touchY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (step === 3) return; // done screen: no swipe nav
    const dx = e.changedTouches[0].clientX - touchX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - touchY.current);
    if (dy > Math.abs(dx) || Math.abs(dx) < 50) return; // vertical or too short

    if (dx < -50) {
      // swipe left = next
      if (step === 0) go(1);
      else if (step === 1) void handleWelcomeNext();
      else if (step === 2) void handleSlugNext();
    } else if (dx > 50) {
      // swipe right = back
      if (step === 1) go(0);
      else if (step === 2) go(1);
    }
  }

  const variants = {
    enter: (d: number) => ({ x: prefersReducedMotion ? 0 : d > 0 ? '100%' : '-100%', opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: prefersReducedMotion ? 0 : d > 0 ? '-60%' : '60%', opacity: 0 }),
  };

  const spring = prefersReducedMotion
    ? { duration: 0.15 }
    : { type: 'spring' as const, stiffness: 340, damping: 32 };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-canvas)] overflow-hidden select-none outline-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
    >
      {/* Progress bar */}
      <div className="h-[3px] bg-[var(--color-line)]">
        <motion.div
          className="h-full bg-[var(--color-brand)]"
          animate={{ width: `${(step / 3) * 100}%` }}
          transition={spring}
        />
      </div>

      {/* Top bar */}
      <div className="h-12 flex items-center px-5 shrink-0">
        <AnimatePresence mode="wait">
          {step > 0 && step < 3 && (
            <motion.button
              key="back"
              initial={{ opacity: 0, x: prefersReducedMotion ? 0 : -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -6 }}
              transition={{ duration: 0.15 }}
              onClick={() => go((step - 1) as Step)}
              className="flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors -ml-1 p-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Step content — centered, swipeable */}
      <div className="flex-1 flex items-center justify-center px-6 overflow-hidden">
        <AnimatePresence custom={direction} mode="wait">
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={spring}
            className="w-full max-w-sm"
          >
            {step === 0 && (
              <StepWelcome storeName={storeName} loading={loadingName} onNext={() => go(1)} />
            )}
            {step === 1 && (
              <StepWelcomeText
                value={welcomeText}
                onChange={setWelcomeText}
                onGenerate={handleGenerate}
                generating={generatingWelcome}
                onNext={handleWelcomeNext}
                onSkip={() => go(2)}
              />
            )}
            {step === 2 && (
              <StepSlug
                value={slug}
                onChange={setSlug}
                error={slugError}
                saving={saving}
                onNext={handleSlugNext}
                onSkip={() => go(3)}
              />
            )}
            {step === 3 && (
              <StepDone slug={savedSlug} onComplete={finish} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Step dots */}
      <AnimatePresence>
        {step < 3 && (
          <motion.div
            key="dots"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-16 flex items-center justify-center gap-2 shrink-0"
          >
            {([0, 1, 2] as const).map((i) => (
              <motion.div
                key={i}
                animate={{
                  width: i === step ? 20 : 6,
                  opacity: i <= step ? 1 : 0.35,
                }}
                className="h-1.5 rounded-full bg-[var(--color-brand)]"
                transition={spring}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
