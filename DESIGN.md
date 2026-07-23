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
