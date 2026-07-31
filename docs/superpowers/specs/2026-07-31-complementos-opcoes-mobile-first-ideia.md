# Complementos e opções — ideia de redesign mobile-first (proposta, não implementada)

Data: 2026-07-31

Este documento registra uma **ideia de UX** validada no ZeloPDV
(`ModalModificadores.svelte`, ver
`zelopdv/docs/projects/complementos-opcoes-redesign-mobile-first.md` — mesmo
texto, adaptado à paleta lilás/roxo clara do ZeloMenu em vez do dark navy do
PDV). **Não é um contrato de implementação fechado pra este repo** — quem
priorizar isso aqui deve tratar como ponto de partida e escrever a versão
final do jeito que este repo costuma escrever specs (ver os outros arquivos
nesta pasta), com "Ambiguidades resolvidas" próprias.

O ZeloMenu usa exatamente o mesmo modelo de dados que o ZeloPDV portou
(`ZeloMenuModifierGroup.kind`/`pricingMode`/`minSelections`/`maxSelections`/
`allowsQuantity`/`maxPerOption` em `src/domain/zelomenuModifiers.ts`), então a
ideia se aplica sem mudança de conceito — só de nomes (camelCase em vez das
colunas `snake_case` do banco).

## 1. Por que isso importa aqui também

O editor de grupos do ZeloMenu (`ZeloMenuModifierModal.tsx`, usado em
`CatalogView`) pede os mesmos 4 campos técnicos desacoplados que o ZeloPDV
tinha: `kind` (Variação/Adicional) e `pricingMode` (Acréscimo/Substituir) são
dois selects independentes, sem nada avisando que "Variação" normalmente
deveria vir junto com "Substituir". Testamos essa exata confusão ao vivo no
ZeloPDV com um usuário leigo configurando "Tamanho" — ele marcou o tipo certo
e esqueceu de trocar o preço, o que geraria preço errado na venda. Produtos
como "Monte sua Massa" (que já existe em produção, 5 grupos) sofrem do
segundo problema: formulário empilhado, sem resumo, fácil perder o fio da
meada rolando a tela.

## 2. A ideia (resumo — ver o doc do ZeloPDV pra tabela completa)

1. **Modelo em vez de campos crus.** Em vez de expor `kind` + `pricingMode` +
   `minSelections` + `maxSelections` como 4 controles separados, oferecer 4
   cartões de modelo com exemplo real do produto sendo editado:
   - "Escolha que troca o preço" → `kind='variacao'`, `pricingMode='substituir'`, `maxSelections` fixo em 1.
   - "Adicional que soma ao preço" → `kind='adicional'`, `pricingMode='somar'`.
   - "Opção incluída, sem custo extra" → mesmo par técnico do anterior; diferença é só pedagógica (lojista vai cadastrar preço 0).
   - "Adicional com quantidade (pode repetir)" → `kind='adicional'`, `pricingMode='somar'`, `allowsQuantity=true`.
   "Configurações avançadas" continua expondo os campos crus pra fugir do
   padrão quando precisar (o ZeloMenu já tem mais regras de validação nesse
   espaço — ex. `allowsQuantity` proibido com `kind==='variacao'` — manter
   todas elas disponíveis ali).
2. **Lista → detalhe, não wizard.** Tela com a lista de grupos (nome + tags
   de status compactas); tocar num grupo abre só aquele grupo em tela cheia
   com voltar, sem sequência forçada. Em telas largas (`≥ 1024px`), lista e
   detalhe lado a lado.
3. **Resumo geral só na lista**, recolhido (rodapé no mobile, expansível
   inline no desktop), nunca dentro da tela de detalhe de um grupo.

## 3. Adaptação de marca (diferença do doc do ZeloPDV)

O ZeloPDV é dark navy com um único acento sky-500. O ZeloMenu é **claro**,
marca lilás/roxo (`#6E3AFF` / `--color-brand`), fundo `#F5F2FF` / branco,
verde (`--color-success`) reservado a estados de sucesso — não usar lilás
como segunda cor de destaque nem inventar uma terceira cor pros cartões de
modelo. Os cartões de modelo devem usar a mesma superfície branca/cinza-claro
(`--zm-surface` / `--zm-surface-muted`) que o resto do admin já usa, com o
cartão selecionado destacado por borda `--color-brand`, não por preenchimento
colorido — mantém consistência com o resto do painel administrativo
(`AdminPage`, `CatalogView`), que é predominantemente branco/cinza com o roxo
reservado a ações primárias.

## 4. Fora de escopo desta nota

- Qualquer mudança de schema, de `src/domain/zelomenuModifiers.ts` ou da
  vitrine pública (`ZeloMenuStorePage`/carrinho) — a ideia é só sobre
  `ZeloMenuModifierModal.tsx` (admin).
- Implementação — nenhum código foi escrito a partir desta nota. Quando
  alguém priorizar, abrir uma spec própria nesta mesma pasta seguindo o
  formato dos outros documentos (Escopo IN/OUT, modelo de dados se houver
  mudança, testes, Ambiguidades resolvidas).
