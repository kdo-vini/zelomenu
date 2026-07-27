import { ArrowRight, LayoutDashboard, MessageCircle, ScrollText } from 'lucide-react';

const products = [
  {
    name: 'ZeloPDV',
    icon: LayoutDashboard,
    desc: 'O PDV inteligente que organiza vendas, caixa e financeiro.',
    href: 'https://zelopdv.com.br',
    cta: 'Conhecer',
  },
  {
    name: 'ZeloChat',
    icon: MessageCircle,
    desc: 'Automatize atendimento e pedidos pelo WhatsApp com IA.',
    href: 'https://chat.zelopdv.com.br',
    cta: 'Conhecer',
  },
  {
    name: 'ZeloMenu',
    icon: ScrollText,
    desc: 'Cardápios digitais, pedidos online e relacionamento com clientes.',
    href: 'https://menu.zelopdv.com.br',
    cta: 'Saiba mais',
  },
];

export function EcosystemSection() {
  return (
    <section className="home-section home-ecosystem" aria-labelledby="ecosystem-title">
      <div className="home-section-header">
        <div>
          <h2 id="ecosystem-title">Conheça o ecossistema Zelo</h2>
          <p>Ferramentas completas para o seu negócio de alimentação.</p>
        </div>
      </div>
      <div className="home-ecosystem__grid">
        {products.map((product) => (
          <a key={product.name} className="home-ecosystem__card" href={product.href} target={product.href.startsWith('http') ? '_blank' : undefined} rel={product.href.startsWith('http') ? 'noopener noreferrer' : undefined}>
            <div className="home-ecosystem__card-icon">
              <product.icon size={24} strokeWidth={1.5} />
            </div>
            <h3>{product.name}</h3>
            <p>{product.desc}</p>
            <span className="home-ecosystem__cta">
              {product.cta}
              <ArrowRight size={16} strokeWidth={2.5} />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
