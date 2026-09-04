import { useEffect } from 'react';
import { ArrowRight, Check, ExternalLink, Info, LayoutDashboard, MessageCircle } from 'lucide-react';
import { Footer } from '../components/home/Footer.tsx';
import { Header } from '../components/home/Header.tsx';
import '../styles/zelomenu-info.css';

const platformCards = [
  {
    name: 'ZeloPDV',
    eyebrow: 'Gestão do negócio',
    description: 'Organize a operação da sua empresa de alimentação em um só lugar.',
    features: [
      'Vendas, caixa e financeiro integrados',
      'Mais controle para a rotina do negócio',
      'Base para ativar o ZeloMenu',
    ],
    href: 'https://zelopdv.com.br',
    action: 'Conhecer o ZeloPDV',
    icon: LayoutDashboard,
    modifier: 'zelo-info-card--pdv',
  },
  {
    name: 'ZeloChat',
    eyebrow: 'Atendimento e pedidos',
    description: 'Atenda seus clientes e receba pedidos pelo WhatsApp com mais agilidade.',
    features: [
      'Atendimento centralizado no WhatsApp',
      'Automação de conversas com IA',
      'Pedidos conectados ao ecossistema Zelo',
    ],
    href: 'https://chat.zelopdv.com.br',
    action: 'Conhecer o ZeloChat',
    icon: MessageCircle,
    modifier: 'zelo-info-card--chat',
  },
];

export function ZeloMenuInfoPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute('content');

    document.title = 'ZeloMenu para empresas — Cardápio digital e pedidos online';
    description?.setAttribute(
      'content',
      'Conheça o ZeloMenu: cardápio digital, pedidos online e integração com ZeloPDV e ZeloChat.',
    );

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.setAttribute('content', previousDescription);
    };
  }, []);

  return (
    <div className="zelo-home zelo-info-page">
      <Header context="info" />

      <main>
        <section className="zelo-info-hero" aria-labelledby="zelo-info-title">
          <div className="home-container zelo-info-hero__inner">
            <p className="zelo-info-hero__eyebrow">Antes de começar</p>
            <h1 id="zelo-info-title">O ZeloMenu funciona junto com as ferramentas da Zelo.</h1>
            <p className="zelo-info-hero__lead">
              O ZeloMenu é uma extensão paga do ZeloPDV e do ZeloChat para publicar cardápios digitais,
              receber pedidos online e se relacionar com seus clientes.
            </p>

            <aside className="zelo-info-notice" role="note">
              <Info size={22} strokeWidth={2.2} aria-hidden="true" />
              <p>
                <strong>Importante:</strong> para ter acesso ao ZeloMenu, você precisa criar uma conta em uma
                das duas plataformas. A contratação e o acesso acontecem pela plataforma escolhida — não é
                necessário criar uma conta separada no ZeloMenu.
              </p>
            </aside>
          </div>
        </section>

        <section className="zelo-info-platforms" aria-labelledby="zelo-info-platforms-title">
          <div className="home-container">
            <header className="zelo-info-section-heading">
              <p className="zelo-info-section-heading__eyebrow">Escolha por onde começar</p>
              <h2 id="zelo-info-platforms-title">Duas plataformas. Um ecossistema para o seu negócio.</h2>
              <p>Conheça a opção que mais combina com a rotina da sua empresa e crie sua conta por lá.</p>
            </header>

            <div className="zelo-info-platform-grid">
              {platformCards.map((platform) => {
                const Icon = platform.icon;

                return (
                  <a
                    key={platform.name}
                    className={`zelo-info-card ${platform.modifier}`}
                    href={platform.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="zelo-info-card__topline">
                      <div className="zelo-info-card__icon">
                        <Icon size={26} strokeWidth={1.9} aria-hidden="true" />
                      </div>
                      <ExternalLink size={19} strokeWidth={2} aria-hidden="true" />
                    </div>

                    <p className="zelo-info-card__eyebrow">{platform.eyebrow}</p>
                    <h3>{platform.name}</h3>
                    <p className="zelo-info-card__description">{platform.description}</p>

                    <ul className="zelo-info-card__features">
                      {platform.features.map((feature) => (
                        <li key={feature}>
                          <Check size={17} strokeWidth={2.5} aria-hidden="true" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>

                    <span className="zelo-info-card__action">
                      {platform.action}
                      <ArrowRight size={19} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                  </a>
                );
              })}
            </div>

            <div className="zelo-info-next-step">
              <p>Depois de criar sua conta, você poderá contratar e acessar o ZeloMenu pela plataforma escolhida.</p>
              <a href="/">
                Voltar para a página inicial
                <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
