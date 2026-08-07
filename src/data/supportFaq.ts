import { normalizeText } from '../utils/normalizeText';

export type FaqCategory =
  | 'getting_started'
  | 'products'
  | 'publication'
  | 'images'
  | 'organization'
  | 'orders'
  | 'settings'
  | 'troubleshooting';

export type FaqEntry = {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
  keywords: string[];
  relatedIds?: string[];
  action?: { label: string; hash: string };
};

export function searchFaqEntries(
  entries: FaqEntry[],
  query: string,
  category: FaqCategory | null = null,
): FaqEntry[] {
  const normalizedQuery = normalizeText(query);
  const scoped = entries.filter((entry) => category === null || entry.category === category);
  if (!normalizedQuery) return scoped;

  return scoped
    .map((entry) => {
      const question = normalizeText(entry.question);
      const answer = normalizeText(entry.answer);
      const keywords = entry.keywords.map(normalizeText);
      const score = question === normalizedQuery
        ? 100
        : question.startsWith(normalizedQuery)
          ? 80
          : keywords.some((keyword) => keyword === normalizedQuery)
            ? 70
            : question.includes(normalizedQuery)
              ? 50
              : keywords.some((keyword) => keyword.includes(normalizedQuery))
                ? 35
                : answer.includes(normalizedQuery)
                  ? 15
                  : 0;
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.question.localeCompare(b.entry.question, 'pt-BR'))
    .map(({ entry }) => entry);
}

export const FAQ_CATEGORIES: Array<{ id: FaqCategory; label: string; description: string }> = [
  { id: 'getting_started', label: 'Primeiros passos', description: 'Comece a organizar e publicar seu cardápio.' },
  { id: 'products', label: 'Produtos e preços', description: 'Cadastre itens, preços e disponibilidade.' },
  { id: 'publication', label: 'Publicação', description: 'Entenda o que aparece no link do cardápio.' },
  { id: 'images', label: 'Imagens e descrição', description: 'Deixe cada produto claro para o cliente.' },
  { id: 'organization', label: 'Organização', description: 'Categorias, complementos e ordem dos itens.' },
  { id: 'orders', label: 'Pedidos e operação', description: 'Pedidos, WhatsApp, Pix e entrega.' },
  { id: 'settings', label: 'Configurações', description: 'Ajuste a loja, horários e link público.' },
  { id: 'troubleshooting', label: 'Resolver problemas', description: 'Caminhos rápidos para situações inesperadas.' },
];

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'create-first-product',
    category: 'getting_started',
    question: 'Como cadastro meu primeiro produto?',
    answer: 'Abra Cardápio, toque em Novo produto, informe nome e preço, escolha uma categoria e salve. Depois, abra Configurar publicação para definir como ele aparecerá no link.',
    keywords: ['cadastrar', 'criar', 'novo item', 'primeiro produto'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
    relatedIds: ['create-category', 'publish-product'],
  },
  {
    id: 'create-category',
    category: 'getting_started',
    question: 'Como crio uma categoria ou subcategoria?',
    answer: 'No Cardápio, use Nova categoria para criar uma categoria principal. Dentro dela, use o menu de ações e escolha Nova subcategoria. Categorias ajudam o cliente a encontrar os produtos mais rápido.',
    keywords: ['categoria', 'subcategoria', 'organizar'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
  },
  {
    id: 'public-menu-link',
    category: 'getting_started',
    question: 'Onde encontro o link público do meu cardápio?',
    answer: 'Abra Publicação e procure o cartão Link público do cardápio. Use o botão de copiar para compartilhar o endereço. O link mostra somente itens publicados e disponíveis.',
    keywords: ['link', 'endereço', 'url', 'compartilhar'],
    action: { label: 'Abrir Publicação', hash: '#publication' },
  },
  {
    id: 'preview-menu',
    category: 'getting_started',
    question: 'Como vejo o que o cliente está vendo?',
    answer: 'Na área Publicação, use o link público para abrir uma prévia em outra aba. Faça uma atualização depois de salvar uma mudança para confirmar o estado publicado.',
    keywords: ['visualizar', 'prévia', 'cliente', 'cardápio online'],
    action: { label: 'Abrir Publicação', hash: '#publication' },
  },
  {
    id: 'where-to-start',
    category: 'getting_started',
    question: 'Qual é a ordem mais rápida para configurar a loja?',
    answer: 'Crie categorias, cadastre produtos e preços, configure as informações públicas, publique os itens e então confira o link como cliente. Se você já tem muitos produtos, use a busca e as ações coletivas para acelerar.',
    keywords: ['começar', 'configurar', 'ordem', 'passo a passo'],
    relatedIds: ['create-first-product', 'publish-product', 'bulk-actions'],
  },
  {
    id: 'edit-price',
    category: 'products',
    question: 'Como altero rapidamente o preço de um produto?',
    answer: 'Localize o produto no Cardápio, abra o menu de três pontos, escolha Editar produto, altere o preço na mesma tela e salve. O preço usa reais e centavos.',
    keywords: ['preço', 'valor', 'editar preço', 'editar produto', 'reais', 'centavos'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
    relatedIds: ['save-product', 'price-not-updated'],
  },
  {
    id: 'save-product',
    category: 'products',
    question: 'Como edito nome, preço ou categoria do produto?',
    answer: 'Abra o menu de ações do produto e escolha Editar produto. Altere os dados necessários e toque em Salvar alterações. Enquanto o salvamento estiver em andamento, não feche o editor nem toque várias vezes no botão.',
    keywords: ['editar produto', 'nome', 'preço', 'categoria', 'salvar'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
  },
  {
    id: 'pause-product',
    category: 'products',
    question: 'Como pauso ou retomo um produto?',
    answer: 'Localize o produto e abra o menu de três pontos. Escolha Pausar em todos os usos ou Reativar. A pausa global afeta o produto vendido separadamente e todas as marmitas que o utilizam; a configuração é preservada.',
    keywords: ['pausar', 'retomar', 'reativar', 'despausar', 'indisponível', 'temporário'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
    relatedIds: ['publication-statuses', 'undo-publication'],
  },
  {
    id: 'hide-product',
    category: 'products',
    question: 'Qual é a diferença entre ocultar no PDV e pausar no cardápio?',
    answer: 'Disponível para venda é o estado global do produto canônico. Ao desligá-lo, ele deixa de aparecer sozinho e também em todos os grupos que o utilizam. Vender separadamente é outra decisão: controla apenas se o produto tem um card próprio no cardápio.',
    keywords: ['oculto', 'pdv', 'pausado', 'diferença', 'disponibilidade'],
  },
  {
    id: 'delete-product',
    category: 'products',
    question: 'Como excluo um produto sem apagar por engano?',
    answer: 'Abra o menu de três pontos, escolha Excluir produto e confira o nome no diálogo de confirmação. A exclusão é definitiva; para uma indisponibilidade temporária, prefira pausar ou despublicar.',
    keywords: ['excluir', 'apagar', 'remover', 'definitivo'],
  },
  {
    id: 'stock-product',
    category: 'products',
    question: 'Por que aparece “Sem estoque” no produto?',
    answer: 'O produto está sendo bloqueado pelo controle de estoque. Confira o estoque operacional na origem do cadastro e publique novamente somente depois que houver disponibilidade. Não apague o produto para resolver falta temporária.',
    keywords: ['estoque', 'sem estoque', 'quantidade', 'bloqueado'],
  },
  {
    id: 'publish-product',
    category: 'publication',
    question: 'Como publico um produto no cardápio?',
    answer: 'No Cardápio, abra Editar produto, ative Vender separadamente no cardápio e salve. Um produto usado somente como complemento pode permanecer sem publicação própria.',
    keywords: ['publicar', 'publicação', 'aparecer', 'link'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
  },
  {
    id: 'unpublish-product',
    category: 'publication',
    question: 'Como retiro um produto do link sem apagá-lo?',
    answer: 'Abra Editar produto e desative Vender separadamente no cardápio. O produto continua salvo e seus vínculos como complemento não são removidos.',
    keywords: ['despublicar', 'retirar', 'link', 'não aparecer'],
    action: { label: 'Abrir Publicação', hash: '#publication' },
  },
  {
    id: 'publication-statuses',
    category: 'publication',
    question: 'O que significam Disponível, Pausado e Somente complemento?',
    answer: 'Disponível significa que o produto pode ser usado. Pausado é uma pausa global. Sem estoque bloqueia o item quando o estoque é controlado. Somente complemento significa que ele não é vendido sozinho, mas pode aparecer dentro de um produto-pai. Ocultado automaticamente significa que um grupo obrigatório ficou sem opções suficientes.',
    keywords: ['status', 'disponível', 'publicado', 'pausado', 'somente complemento', 'oculto', 'sumiu'],
    relatedIds: ['pause-product', 'publish-product'],
  },
  {
    id: 'bulk-actions',
    category: 'publication',
    question: 'Como publico vários produtos?',
    answer: 'Use Selecionar no topo do Cardápio, marque os produtos e escolha Publicar no link. A pausa é global e deve ser feita pelo menu de três pontos de cada produto, para deixar claro que ela afeta todos os usos.',
    keywords: ['massa', 'vários', 'selecionar', 'lote', 'bulk'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
  },
  {
    id: 'undo-publication',
    category: 'publication',
    question: 'Posso desfazer uma pausa ou publicação?',
    answer: 'Quando a ação puder ser revertida com segurança, o painel mostra Desfazer logo após a confirmação. Use-o imediatamente; depois que a mensagem desaparecer, faça a alteração novamente pelo menu do produto.',
    keywords: ['desfazer', 'undo', 'reverter', 'voltar'],
  },
  {
    id: 'publication-not-showing',
    category: 'publication',
    question: 'Publiquei, mas o produto ainda não aparece no link. O que faço?',
    answer: 'Confira se o produto não está pausado, oculto ou sem estoque. Atualize o link público e confirme que a categoria também está visível. Se o problema continuar, abra o suporte informando o nome do produto e a tela em que a mudança foi feita.',
    keywords: ['não aparece', 'publicado', 'link', 'cliente não vê'],
    relatedIds: ['publication-statuses', 'support-contact'],
  },
  {
    id: 'upload-image',
    category: 'images',
    question: 'Como adiciono uma imagem ao produto?',
    answer: 'Abra Editar produto, vá para Configurações de publicação e use Imagem do produto. Selecione a foto, ajuste o recorte quadrado e salve. A imagem é configurada diretamente no ZeloMenu.',
    keywords: ['imagem', 'foto', 'enviar', 'upload', 'publicação'],
    action: { label: 'Abrir Publicação', hash: '#publication' },
  },
  {
    id: 'replace-image',
    category: 'images',
    question: 'Como troco ou removo a imagem de um produto?',
    answer: 'Abra a publicação do produto, escolha uma nova imagem ou use a opção de remover a foto atual. Confira a prévia antes de salvar para garantir que o recorte não cortou o produto.',
    keywords: ['trocar foto', 'remover imagem', 'substituir', 'recorte'],
  },
  {
    id: 'image-recommendation',
    category: 'images',
    question: 'Qual imagem funciona melhor no cardápio?',
    answer: 'Prefira uma foto nítida, quadrada, com boa luz e o produto centralizado. Evite textos pequenos, bordas vazias e imagens muito escuras. O recorte do editor mostra como o arquivo será usado.',
    keywords: ['foto boa', 'quadrada', 'qualidade', 'tamanho'],
  },
  {
    id: 'public-description',
    category: 'images',
    question: 'Como altero o nome e a descrição que o cliente vê?',
    answer: 'Na publicação do produto, preencha Nome público e Descrição pública. Se Nome público ficar vazio, o cardápio usa o nome operacional do produto. Salve para atualizar a vitrine.',
    keywords: ['nome público', 'descrição', 'texto', 'cliente'],
  },
  {
    id: 'reorder-category',
    category: 'organization',
    question: 'Como mudo a ordem dos produtos?',
    answer: 'Ative Ordenar no Cardápio e arraste os produtos para a posição desejada. Saia do modo de ordenação quando terminar e aguarde a confirmação da gravação.',
    keywords: ['ordenar', 'ordem', 'arrastar', 'posição'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
  },
  {
    id: 'edit-category',
    category: 'organization',
    question: 'Como renomeio ou excluo uma categoria?',
    answer: 'Abra o menu de três pontos da categoria e escolha Editar categoria ou Excluir categoria. Antes de excluir, mova ou revise os produtos associados e confirme o nome exibido no diálogo.',
    keywords: ['renomear categoria', 'excluir categoria', 'editar categoria'],
  },
  {
    id: 'subcategories',
    category: 'organization',
    question: 'Quando devo usar uma subcategoria?',
    answer: 'Use uma subcategoria quando uma categoria tiver muitos itens e o cliente se beneficiar de uma divisão clara, como Massas > Molhos. Evite criar subcategorias para poucos produtos sem uma diferença real.',
    keywords: ['subcategoria', 'dividir', 'organização'],
  },
  {
    id: 'modifiers',
    category: 'organization',
    question: 'Como cadastro complementos e escolhas do produto?',
    answer: 'Abra Editar produto e use a área de Complementos e variações. Crie grupos, defina opções e preços adicionais e salve. Revise a prévia para confirmar o que o cliente poderá escolher.',
    keywords: ['complemento', 'adicional', 'variação', 'opção'],
  },
  {
    id: 'linked-products',
    category: 'organization',
    question: 'O que são produtos vinculados em uma opção?',
    answer: 'Um produto vinculado permite reaproveitar um item do catálogo dentro de uma opção. Use isso quando a mesma escolha precisar manter preço e cadastro consistentes em mais de um lugar.',
    keywords: ['vinculado', 'reaproveitar', 'opção', 'produto'],
  },
  {
    id: 'why-product-disappeared',
    category: 'troubleshooting',
    question: 'Por que meu produto sumiu do cardápio?',
    answer: 'O ZeloMenu oculta automaticamente um produto quando ele está pausado, sem estoque ou quando um grupo obrigatório não tem opções disponíveis suficientes. Pesquise pelo produto no Cardápio: o status mostra o motivo e o grupo que precisa ser corrigido. Reative o item, ajuste o estoque ou disponibilize a quantidade mínima de opções; ele volta automaticamente.',
    keywords: ['sumiu', 'desapareceu', 'ocultado automaticamente', 'grupo obrigatório', 'mistura', 'cardápio'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
    relatedIds: ['pause-product', 'stock-product', 'linked-products'],
  },
  {
    id: 'link-or-create-component',
    category: 'organization',
    question: 'Devo vincular um componente existente ou criar outro?',
    answer: 'Pesquise primeiro pelo nome do produto. Se ele já existir, use o cadastro existente para compartilhar preço, estoque e pausa global. Crie um novo produto somente quando for realmente uma escolha diferente. O sistema bloqueia nomes iguais e alerta sobre nomes parecidos para evitar duplicatas.',
    keywords: ['vincular', 'criar produto', 'duplicata', 'componente', 'adicional'],
    action: { label: 'Abrir Cardápio', hash: '#catalog' },
  },
  {
    id: 'delete-component-category',
    category: 'organization',
    question: 'Posso excluir a categoria de componentes?',
    answer: 'Sim. Categorias organizam produtos vendidos separadamente; elas não são donas dos componentes. Ao excluir uma categoria, os produtos continuam salvos e os vínculos com grupos permanecem. Produtos vendidos separadamente precisam ser movidos para uma categoria comercial antes de aparecerem novamente no cardápio.',
    keywords: ['excluir categoria', 'componentes', 'categoria legada', 'marmita'],
  },
  {
    id: 'order-received',
    category: 'orders',
    question: 'Onde acompanho um pedido recebido pelo cardápio?',
    answer: 'A jornada do pedido depende da configuração de pedidos e do canal conectado à loja. Confira Configurações e, se o pedido não chegar ao canal esperado, envie ao suporte o horário, a tela e o identificador do pedido.',
    keywords: ['pedido', 'receber', 'acompanhar', 'cliente'],
    action: { label: 'Abrir Configurações', hash: '#settings' },
  },
  {
    id: 'whatsapp-orders',
    category: 'orders',
    question: 'Como o pedido chega ao WhatsApp?',
    answer: 'O cliente finaliza o pedido no cardápio e usa o canal configurado pela loja. Confira o número e as preferências de pedidos nas Configurações. O ZeloMenu não envia mensagens de suporte automaticamente.',
    keywords: ['whatsapp', 'pedido', 'mensagem', 'canal'],
    action: { label: 'Abrir Configurações', hash: '#settings' },
  },
  {
    id: 'pix-settings',
    category: 'orders',
    question: 'Onde configuro o Pix?',
    answer: 'Abra Configurações e localize a área de pagamento Pix. Informe a chave compatível com o tipo selecionado e salve. Faça um teste de leitura antes de divulgar o link.',
    keywords: ['pix', 'pagamento', 'chave', 'cobrança'],
    action: { label: 'Abrir Configurações', hash: '#settings' },
  },
  {
    id: 'delivery-settings',
    category: 'orders',
    question: 'Como configuro entrega, retirada e horários de pedido?',
    answer: 'Use Configurações para definir cobertura, preço, horários e regras de entrega. Confira também os horários comerciais para evitar que o cliente veja uma opção disponível fora da operação.',
    keywords: ['entrega', 'retirada', 'horário', 'frete'],
    action: { label: 'Abrir Configurações', hash: '#settings/entrega/configurar' },
  },
  {
    id: 'coupons',
    category: 'orders',
    question: 'Como configuro cupons ou descontos?',
    answer: 'Abra Configurações e acesse a área de cupons. Defina validade, regras e limite de uso antes de salvar. Faça uma compra de teste sempre que uma regra nova entrar em produção.',
    keywords: ['cupom', 'desconto', 'promoção', 'validade'],
    action: { label: 'Abrir Configurações', hash: '#settings' },
  },
  {
    id: 'brand-settings',
    category: 'settings',
    question: 'Onde altero logo, capa e aparência do cardápio?',
    answer: 'Abra Publicação e use Visual externo para ajustar a identidade que aparece para o cliente. Salve e confira o link público em uma nova aba.',
    keywords: ['logo', 'capa', 'aparência', 'visual'],
    action: { label: 'Abrir Publicação', hash: '#publication' },
  },
  {
    id: 'business-hours',
    category: 'settings',
    question: 'Como configuro os horários de funcionamento?',
    answer: 'Abra Configurações, entre em Horários e ajuste os períodos por dia. Confirme se o fuso e os intervalos correspondem à rotina real da loja.',
    keywords: ['horário', 'funcionamento', 'aberto', 'fechado'],
    action: { label: 'Abrir Horários', hash: '#settings/horarios' },
  },
  {
    id: 'public-slug',
    category: 'settings',
    question: 'Como altero o endereço curto do meu cardápio?',
    answer: 'Na área de Publicação, ajuste o slug do link público e salve. Compartilhe o novo endereço somente depois de testá-lo em uma aba anônima ou em outro dispositivo.',
    keywords: ['slug', 'endereço curto', 'link público', 'url'],
    action: { label: 'Abrir Publicação', hash: '#publication' },
  },
  {
    id: 'tables',
    category: 'settings',
    question: 'Onde encontro mesas e QR Codes?',
    answer: 'Quando o recurso estiver habilitado no seu plano, Mesas aparece no menu Mais. A área permite consultar mesas e baixar os QR Codes correspondentes.',
    keywords: ['mesa', 'qr code', 'qrcode', 'comanda'],
    action: { label: 'Abrir Mesas', hash: '#mesas' },
  },
  {
    id: 'metrics',
    category: 'settings',
    question: 'Onde vejo os indicadores do cardápio?',
    answer: 'Abra o menu Mais e escolha Indicadores. Use os números para entender publicação, pedidos e operação, mas confirme sempre os dados na tela de origem antes de tomar uma decisão urgente.',
    keywords: ['indicadores', 'métricas', 'relatório', 'números'],
    action: { label: 'Abrir Indicadores', hash: '#indicadores' },
  },
  {
    id: 'price-not-updated',
    category: 'troubleshooting',
    question: 'Salvei o preço, mas a alteração não apareceu.',
    answer: 'Confira se apareceu a confirmação de salvamento, atualize o Cardápio e abra o produto novamente. Se o editor mostrar o valor antigo, não repita vários envios: registre o nome do produto e encaminhe o caso ao suporte.',
    keywords: ['preço não atualiza', 'salvar', 'valor antigo', 'não mudou'],
    relatedIds: ['edit-price', 'support-contact'],
  },
  {
    id: 'image-failed',
    category: 'troubleshooting',
    question: 'A imagem não carrega ou não salva.',
    answer: 'Verifique a conexão, tente uma imagem menor e confirme se o arquivo abre normalmente no dispositivo. Se o problema persistir, informe o produto, o formato do arquivo e o momento em que o erro apareceu ao suporte.',
    keywords: ['imagem falha', 'upload erro', 'foto não salva', 'arquivo'],
    relatedIds: ['upload-image', 'support-contact'],
  },
  {
    id: 'login-problem',
    category: 'troubleshooting',
    question: 'Não consigo entrar no ZeloMenu.',
    answer: 'Confira o e-mail da conta, tente a recuperação de acesso e abra o painel novamente. Nunca envie sua senha pelo WhatsApp. Se o acesso continuar bloqueado, encaminhe apenas o e-mail da conta e a mensagem exibida.',
    keywords: ['login', 'entrar', 'senha', 'acesso'],
    relatedIds: ['support-contact'],
  },
  {
    id: 'connection-error',
    category: 'troubleshooting',
    question: 'A tela está carregando ou aparece erro de conexão.',
    answer: 'Confira a internet, aguarde alguns segundos e use Atualizar uma vez. Se a falha persistir, anote a tela, o horário e a ação que estava tentando fazer para o suporte investigar com precisão.',
    keywords: ['carregando', 'conexão', 'erro', 'atualizar', 'internet'],
    relatedIds: ['support-contact'],
  },
  {
    id: 'support-contact',
    category: 'troubleshooting',
    question: 'Como falo com o suporte?',
    answer: 'Pesquise sua dúvida primeiro. Se as respostas não resolverem, escolha Ainda preciso de ajuda, descreva o problema e use Continuar no WhatsApp. O painel abrirá uma mensagem pronta para o número oficial de suporte; revise e envie pelo próprio WhatsApp.',
    keywords: ['suporte', 'ajuda', 'whatsapp', 'contato', 'atendimento'],
  },
];
