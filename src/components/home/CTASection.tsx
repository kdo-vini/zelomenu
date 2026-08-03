import { HelpCircle, ArrowRight } from 'lucide-react';

export function CTASection() {
  return (
    <section className="home-section home-cta" id="sobre" aria-labelledby="home-cta-title">
      <div className="home-cta__secondary">
        <div className="home-cta__icon">
          <HelpCircle size={25} strokeWidth={2} />
        </div>
        <div>
          <h2>Não encontrou sua empresa favorita?</h2>
          <p>Solicite o link do cardápio diretamente ao estabelecimento e peça pelo WhatsApp.</p>
        </div>
        <a href="/">
          Saiba como
          <ArrowRight size={18} strokeWidth={2} />
        </a>
      </div>

      <div className="home-cta__primary">
        <div className="home-cta__icon home-cta__icon--primary">
          <img src="/assets/brand/logofundobrancozelomenu-64.webp" alt="" width="36" height="36" className="h-9 w-9 object-contain" />
        </div>
        <div>
          <span className="home-cta__kicker">Para empresas</span>
          <h2 id="home-cta-title">Quer ter um cardápio digital como este?</h2>
          <p>Organize pedidos online, receba pelo WhatsApp, compartilhe via QR Code e conecte com ZeloPDV e ZeloChat.</p>
        </div>
        <a className="home-button home-button--light" href="/conhecer-zelomenu">
          Conhecer ZeloMenu
          <ArrowRight size={20} strokeWidth={2.5} />
        </a>
      </div>
    </section>
  );
}
