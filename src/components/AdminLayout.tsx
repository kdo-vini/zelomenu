import { type ReactNode, useState } from 'react';
import { Menu, ShoppingBag, Globe2, LayoutGrid, LogOut, Settings, X } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

// ─── Navigation definition ─────────────────────────────────────────────────

export type NavSection = 'catalog' | 'publication' | 'settings' | 'mesas';

interface NavItem {
  id: NavSection;
  label: string;
  icon: typeof ShoppingBag;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'catalog', label: 'Cardápio', icon: ShoppingBag },
  { id: 'publication', label: 'Publicação', icon: Globe2 },
  { id: 'settings', label: 'Configurações', icon: Settings },
  { id: 'mesas', label: 'Mesas', icon: LayoutGrid },
];

// ─── Props ─────────────────────────────────────────────────────────────────

interface AdminLayoutProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  catalogContent: ReactNode;
  publicationContent: ReactNode;
  settingsContent: ReactNode;
  mesasContent?: ReactNode;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function AdminLayout({ activeSection, onNavigate, catalogContent, publicationContent, settingsContent, mesasContent }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => item.id !== 'mesas' || mesasContent !== undefined,
  );

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex h-full bg-[var(--color-canvas)]">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:border-[var(--color-line)] md:bg-[var(--color-surface)]">
        <div className="flex h-16 items-center gap-3 border-b border-[var(--color-line)] px-5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--color-brand-soft)]">
            <img src="/assets/brand/logozelomenu-optimized.png" alt="" className="h-full w-full object-contain" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-[var(--color-ink)]">ZeloMenu</span>
            <span className="text-[11px] text-[var(--color-ink-muted)]">Painel do cardapio</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
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
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-alert)]"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.7} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-[var(--color-surface)] shadow-xl transition-transform duration-200 ease-out md:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Navegação"
      >
        <div className="flex h-16 items-center justify-between border-b border-[var(--color-line)] px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--color-brand-soft)]">
              <img src="/assets/brand/logozelomenu-optimized.png" alt="" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-semibold text-[var(--color-ink)]">ZeloMenu</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="min-h-11 min-w-11 rounded-lg p-2 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setSidebarOpen(false); }}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
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
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-alert)]"
          >
            <LogOut className="h-5 w-5" strokeWidth={1.7} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="flex h-14 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="min-h-11 min-w-11 rounded-lg p-2 text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--color-brand-soft)]">
              <img src="/assets/brand/logozelomenu-optimized.png" alt="" className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-semibold text-[var(--color-ink)]">ZeloMenu</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {activeSection === 'catalog' && catalogContent}
          {activeSection === 'publication' && publicationContent}
          {activeSection === 'settings' && settingsContent}
          {activeSection === 'mesas' && mesasContent}
        </main>

        {/* ── Mobile bottom nav ── */}
        <nav
          className="flex h-16 shrink-0 items-center border-t border-[var(--color-line)] bg-[var(--color-surface)] px-2 md:hidden"
          aria-label="Navegação principal"
        >
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'text-[var(--color-brand-deep)]'
                    : 'text-[var(--color-ink-muted)]'
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.7} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
