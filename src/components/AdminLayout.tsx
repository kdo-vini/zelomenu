import { type ReactNode, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue } from 'motion/react';
import { ShoppingBag, Globe2, LogOut } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

// ─── Navigation definition ─────────────────────────────────────────────────

export type NavSection = 'catalog' | 'publication';

interface NavItem {
  id: NavSection;
  label: string;
  icon: typeof ShoppingBag;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'catalog', label: 'Cardápio', icon: ShoppingBag },
  { id: 'publication', label: 'Publicação', icon: Globe2 },
];

// ─── Props ─────────────────────────────────────────────────────────────────

interface AdminLayoutProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  catalogContent: ReactNode;
  publicationContent: ReactNode;
}

// ─── Breakpoint hook ───────────────────────────────────────────────────────

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(window.innerWidth < 768);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handler = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMobile(window.innerWidth < 768), 80);
    };
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('resize', handler);
      clearTimeout(timer.current);
    };
  }, []);

  return mobile;
}

// ─── Mobile: swipeable track ───────────────────────────────────────────────

function SwipeTrack({
  activeSection,
  onNavigate,
  catalogContent,
  publicationContent,
}: AdminLayoutProps) {
  const [isDragging, setIsDragging] = useState(false);
  const activeIndex = activeSection === 'catalog' ? 0 : 1;
  const targetX = `-${activeIndex * 100}%`;

  return (
    <div className="relative flex-1 overflow-hidden">
      <motion.div
        drag="x"
        dragElastic={0.15}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(_, info) => {
          setIsDragging(false);
          const threshold = 70;
          if (info.offset.x < -threshold || info.velocity.x < -500) {
            if (activeSection === 'catalog') onNavigate('publication');
          } else if (info.offset.x > threshold || info.velocity.x > 500) {
            if (activeSection === 'publication') onNavigate('catalog');
          }
        }}
        animate={{ x: targetX }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 50,
          mass: 0.65,
          ...(isDragging ? { duration: 0 } : {}),
        }}
        style={{ display: 'flex', width: '200%', willChange: 'transform' }}
        className="h-full"
      >
        <div className="h-full w-1/2 shrink-0 overflow-y-auto">{catalogContent}</div>
        <div className="h-full w-1/2 shrink-0 overflow-y-auto">{publicationContent}</div>
      </motion.div>

      {/* Indicator pills */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center gap-2 md:hidden">
        {NAV_ITEMS.map((item, i) => (
          <div
            key={item.id}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === activeIndex
                ? 'w-6 bg-[var(--color-brand)]'
                : 'w-1.5 bg-[var(--color-line-strong)]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AdminLayout(props: AdminLayoutProps) {
  const { activeSection, onNavigate, catalogContent, publicationContent } = props;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const activeLabel = NAV_ITEMS.find((i) => i.id === activeSection)?.label ?? '';

  return (
    <div className="flex h-full bg-[var(--color-canvas)]">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-[var(--color-line)] md:bg-[var(--color-surface)]">
        <div className="flex h-16 items-center gap-3 border-b border-[var(--color-line)] px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand)] text-white text-xs font-bold">
            ZM
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-[var(--color-ink)]">ZeloMenu</span>
            <span className="text-[11px] text-[var(--color-ink-muted)]">Painel do cardapio</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                    : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.7} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[var(--color-line)] px-3 py-3">
          <button
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-alert)]"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.7} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {isMobile ? (
        /* ── Mobile: top bar + swipeable track ── */
        <div className="flex flex-1 flex-col min-w-0">
          {/* Top bar with section title */}
          <header className="flex h-14 shrink-0 items-center justify-center border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-brand)] text-white text-[10px] font-bold">
                ZM
              </div>
              <span className="text-sm font-semibold text-[var(--color-ink)]">
                {activeLabel}
              </span>
            </div>
          </header>

          <SwipeTrack {...props} />

          {/* Faux bottom bar — just padding so content doesn't hide behind OS nav */}
          <div className="h-4 shrink-0 md:hidden" />
        </div>
      ) : (
        /* ── Desktop: sidebar + content ── */
        <div className="flex flex-1 flex-col min-w-0">
          <main className="flex-1 overflow-y-auto">
            {activeSection === 'catalog' ? catalogContent : publicationContent}
          </main>
        </div>
      )}
    </div>
  );
}
