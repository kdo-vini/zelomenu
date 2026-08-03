export function Footer() {
  return (
    <footer className="home-footer">
      <div className="home-container home-footer__inner">
        <div className="home-footer__brand">
          <img src="/assets/brand/zelomenu-mark.svg" alt="" width="44" height="44" />
          <span>ZeloMenu</span>
        </div>

        <div className="home-footer__ecosystem">
          <p className="home-footer__tagline">Produto desenvolvido por <strong>Zelo</strong>. Conheça também:</p>
          <div className="home-footer__products">
            <a href="https://zelopdv.com.br" target="_blank" rel="noopener noreferrer">
              <strong>ZeloPDV</strong>
              <span>O PDV inteligente para organizar vendas e finanças.</span>
            </a>
            <a href="https://chat.zelopdv.com.br" target="_blank" rel="noopener noreferrer">
              <strong>ZeloChat</strong>
              <span>Automação de atendimento e pedidos por WhatsApp com IA.</span>
            </a>
            <a href="https://menu.zelopdv.com.br">
              <strong>ZeloMenu</strong>
              <span>Cardápios digitais, pedidos online e relacionamento.</span>
            </a>
          </div>
        </div>

      </div>
    </footer>
  );
}
