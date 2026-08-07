# Design System — ZeloMenu

Sistema de design da suíte Zelo. **Marca lilás/roxo** (`#6E3AFF`). Migramos o
verde antigo (`#0b9778`) para esta paleta em 2026-07. Toda cópia de UI é em
**PT-BR**. Alvo de acessibilidade: **WCAG 2.1 AA**.

> ZeloChat ainda usa o verde. Ao sincronizar a identidade, atualizar o bloco
> `@theme` de `ZeloChat/src/index.css` com estes mesmos hexes de marca.

## Paleta da marca

| Elemento          | Cor       | Token                     |
| ----------------- | --------- | ------------------------- |
| Botão primário    | `#6E3AFF` | `--color-brand` / `--zm-brand` |
| Hover             | `#5A2EEA` | `--color-brand-deep` / `--zm-brand-deep` |
| Texto principal   | `#0B1D3A` | `--zm-ink` (vitrine)      |
| Texto secundário  | `#5B6475` | `--zm-ink-soft` (vitrine) |
| Fundo             | `#F5F2FF` | `--zm-canvas` (vitrine)   |
| Card / superfície | `#FFFFFF` | `--color-surface` / `--zm-surface` |
| Borda             | `#E6E8EF` | `--zm-line`               |
| Ícones            | `#6E3AFF` | `--color-brand`           |
| Destaque          | `#C8F000` | `--color-accent` / `--zm-accent` |

## Paleta estendida (mascote + sistema)

| Cor                  | Hex       | Uso                                                                    |
| -------------------- | --------- | --------------------------------------------------------------------- |
| 🔵 Azul Marinho      | `#0B1D3A` | Tela do robô, avental, tipografia escura, elementos principais         |
| 🟣 Roxo Primário     | `#6E3AFF` | Cor da marca, botões, ícones, destaques, logo                          |
| 🟪 Roxo Escuro       | `#5A2EEA` | Hover, gradientes, sombras e profundidade                              |
| 🟣 Lilás Claro       | `#E9E2FF` | Cards, balões, fundos suaves (`--color-brand-soft` / `--zm-brand-soft`)|
| 🟣 Lilás Muito Claro | `#F5F2FF` | Background principal da vitrine (`--zm-canvas`)                        |
| ⚪ Branco             | `#FFFFFF` | Corpo do robô, cartões, espaços negativos                              |
| ⚪ Cinza Claro        | `#ECEEF3` | Bordas, superfícies, sombras suaves (`--zm-surface-muted`)            |
| ⚫ Azul Quase Preto   | `#111C36` | Face do robô (display)                                                 |
| 🟢 Verde Limão       | `#C8F000` | Apenas pequenos detalhes de destaque (estrelas, notificações, sucesso) |

## Proporção de uso

- ⚪ Branco → **45%**
- 🟣 Roxos → **25%**
- 🔵 Azul Marinho → **20%**
- 🩶 Cinzas → **8%**
- 🟢 Verde Limão → **2%** (só acentos pontuais; nunca como cor de marca)

## Cores semânticas

Verde deixou de ser cor de marca e passou a significar **sucesso/positivo**.
Estes tokens semânticos **não** mudaram na migração:

| Semântico | Cor       | Soft      | Token                                  |
| --------- | --------- | --------- | -------------------------------------- |
| Sucesso   | `#0f7c4a` | `#e8f7ef` | `--color-success` / `--color-success-soft` |
| Alerta    | `#d04545` | `#fbe9e9` | `--color-alert` / `--color-alert-soft` |
| Aviso     | `#b87a00` | `#fbf0d8` | `--color-warn` / `--color-warn-soft`   |

Ex.: linha de desconto no carrinho usa `--color-success` (economia = verde
semântico), não a cor de marca.

## Dois escopos de tema

Ambos definidos em `src/index.css`.

1. **`@theme` (global)** — tokens `--color-*`. Painel admin (`/admin`,
   CatalogView, painel de publicação) e componentes compartilhados com o
   ZeloChat. Fundo neutro `#f6f7f8`.
2. **`.zelomenu-theme` (vitrine)** — tokens `--zm-*`. Aplicado só no wrapper de
   `ZeloMenuStorePage` e `ZeloMenuCartPage`. Mesma marca lilás, mas com fundo
   lilás-claro (`#F5F2FF`), tipografia azul-marinho (`#0B1D3A`) e o acento
   verde-limão da vitrine.

Controles nativos (checkbox, radio, range) herdam a marca via
`:root { accent-color: var(--color-brand); }`.

## Regras

- **Contraste:** corpo de texto ≥ 4.5:1; texto grande ≥ 3:1. O verde-limão
  `#C8F000` reprova como texto sobre branco — usar **só** como preenchimento de
  destaque/fundo, nunca como cor de texto sobre superfície clara.
- **Verde-limão é acento pontual** (~2%). Não vira botão, fundo grande nem cor
  de marca.
- **Tap targets** mínimos de 44px; campos de 16px no mobile (evita zoom iOS).
- Novos componentes referenciam **tokens**, nunca hexes crus nem classes
  `*-green-*` do Tailwind.
- **Ações em listas no mobile:** quando uma linha tiver mais de uma ação
  secundária, usar um botão de três pontos que abre uma folha de ações. O nome,
  preço e estado do item permanecem visíveis; editar, configurar e excluir não
  competem com o conteúdo da linha. Ações destrutivas ficam por último e usam a
  cor semântica de alerta.
- **Navegação mobile:** manter no máximo quatro destinos na barra inferior. Os
  três destinos de uso diário ficam visíveis; os demais entram em **Mais** com
  rótulo e ícone, em um menu de fácil alcance. Nunca esconder um destino apenas
  atrás de um ícone sem nome.
- **Ajuda e suporte:** a Central de Ajuda começa pelo FAQ pesquisável e por
  categorias de tarefa. Cada resposta deve oferecer um próximo passo claro; se
  não resolver, abrir uma triagem curta e uma mensagem contextual pronta para o
  WhatsApp. O usuário revisa e envia a mensagem explicitamente.

## Catálogo: controles e estados

O catálogo usa uma entidade de produto canônico. Categoria é apenas uma
organização de produtos vendidos separadamente; um componente pode ficar sem
categoria e continuar pesquisável e vinculado a vários produtos-pai.

| Controle | Usar para | Não usar para |
| --- | --- | --- |
| `SwitchField` / `ToggleCard` | Estado binário persistente: **Disponível para venda** e **Vender separadamente no cardápio** | Comandos destrutivos ou seleção em lote |
| `Checkbox` | Seleção múltipla, seleção em lote e inclusão estrutural em um grupo | Disponibilidade efetiva herdada do produto canônico |
| `Button` | Ação primária ou comando explícito | Estado que precisa permanecer visível |
| `ActionMenu` | Editar, configurar, pausar/reativar e excluir em linhas compactas | A ação primária da tela |
| `SelectField` | Lista finita de categorias, tipos e modos de preço | Busca de produtos |
| `Combobox` | Pesquisar e vincular produto existente; criar novo quando não houver correspondência | Alternar disponibilidade |
| `StatusBadge` | Disponível, Pausado, Sem estoque, Somente complemento e Ocultado automaticamente | Substituir o nome ou esconder o motivo |

Regras de interação:

- Todas as linhas com múltiplas ações secundárias usam três pontos; os nomes das ações aparecem no menu.
- O rótulo de um switch nunca muda quando seu valor muda. A descrição explica o efeito global.
- A disponibilidade global é herdada por todos os usos. A inclusão estrutural de uma opção permanece separada e visível.
- A pausa de um produto-pai é contextual: remove somente o pai do cardápio e não
  altera publicação, inclusão ou disponibilidade dos filhos reutilizados em
  outros pais. A pausa do produto-filho canônico continua sendo global.
- `Vender separadamente no cardápio` nunca é alterado por uma pausa de pai. Um
  componente publicado separadamente permanece como card próprio; um produto
  somente-complemento continua fora da lista de cards, mas disponível nos grupos.
- A cascata de um pai é derivada na leitura. Nunca atualizar filhos, grupos,
  opções ou publicações para simular essa cascata.
- Produtos usados somente como complemento não recebem o estado ambíguo “Não publicado”; mostram “Somente complemento”.
- Menus e folhas de ação têm alvo mínimo de 44px, foco visível, `aria-haspopup`, `aria-expanded`, teclado e estados loading/disabled/erro.
- Toasts confirmam a ação e oferecem **Desfazer** quando a alteração é reversível.
- Busca e filtros virtuais do catálogo usam o mesmo resultado plano de produtos:
  quando qualquer busca ou filtro está ativo, não renderizar categorias ou
  subcategorias vazias antes dos resultados.
- Antipadrão a evitar: filtrar os produtos, mas continuar renderizando a árvore
  completa de categorias. Isso aumenta a rolagem e esconde o resultado que o
  operador acabou de solicitar.
