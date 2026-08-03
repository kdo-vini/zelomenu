import { useState } from 'react';
import { Menu, X, ChevronRight, User } from 'lucide-react';
import { PwaInstallButton } from './PwaInstallButton.tsx';
import { PushNotificationButton } from './PushNotificationButton.tsx';

const navItems = [
  { label: 'Empresas', href: '#empresas' },
  { label: 'Categorias', href: '#categorias' },
  { label: 'Destaques', href: '#destaques' },
  { label: 'Sobre', href: '#sobre' },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="home-header">
      <div className="home-container home-header__inner">
        <a className="home-header__brand" href="/" aria-label="Página inicial do ZeloMenu">
          <img src="/assets/brand/logozelomenu-optimized.png" alt="" />
          <span className="home-header__brand-name">ZeloMenu</span>
        </a>

        <nav className="home-header__nav" aria-label="Navegação principal">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
          <PushNotificationButton />
          <PwaInstallButton />
        </nav>

        <a className="home-button home-button--ghost home-header__business" href="/admin">
          <User size={17} strokeWidth={2.5} />
          Sou empresário
        </a>

        <button
          className="home-header__menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setMenuOpen((current) => !current)}
        >
          {menuOpen ? <X size={24} strokeWidth={2} /> : <Menu size={24} strokeWidth={2} />}
        </button>
      </div>

      {menuOpen && (
        <nav id="mobile-navigation" className="home-header__mobile-nav" aria-label="Navegação mobile">
          <div className="home-container">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                {item.label}
                <ChevronRight size={18} strokeWidth={2} />
              </a>
            ))}
            <a className="home-button home-button--primary" href="/admin">
              Sou empresário
            </a>
            <PushNotificationButton variant="mobile" />
            <PwaInstallButton variant="mobile" />
          </div>
        </nav>
      )}
    </header>
  );
}
