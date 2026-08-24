# Incidentes de produção — ZeloMenu

Runbook curto para diagnosticar rapidamente problemas de preço, deploy e roteamento do cardápio público.

## 0. Visibilidade do PDV não é publicação online

`produtos.ocultar_no_pdv` é somente o controle interno de venda manual do
ZeloPDV. Para o cliente, a fonte de verdade é o overlay
`zelomenu_product_publications`: `visivel_online` publica e
`pausado_manualmente` pausa. Se um produto estiver oculto no PDV, isso não deve
alterar a publicação no storefront. Não corrigir esse caso com backfill de
dados sem instrução explícita do produto; a correção de 2026-08-24 foi somente
de contrato/código e preservou o catálogo da Bem Servido.

## 1. Preço `R$0,00` em produto com grupo `substituir`

### Sintoma

O card do produto mostra `R$0,00`, ou o carrinho soma o preço-base com o preço do tamanho. Exemplo: Marmita P deveria custar `R$18,00`, mas aparece `R$0,00` no card ou vira `R$36,00` no carrinho.

### Modelo correto

O produto-base pode ter preço `0`. O grupo de variação define o preço final:

```text
produto.preco = 0
grupo.modo_preco = substituir
P = 18
M = 22
G = 25
```

O preço escolhido substitui o preço-base. Não existe “massa/tamanho de R$0”; `0` é apenas o valor estrutural do produto quando o grupo controla o preço.

### Verificação no banco

Confirme estes três pontos antes de alterar código:

1. Produto com `preco = 0`.
2. Grupo correto com `modo_preco = 'substituir'`.
3. Opções ativas com `price_delta` nos valores esperados.

Não corrigir esse caso mudando o preço do produto para `18`. Isso quebra M/G e volta a somar preço-base + opção.

### Verificação da API pública

```powershell
$api = Invoke-RestMethod 'https://menu.zelopdv.com.br/api/public/zelomenu/store/bemservido'
$p = @($api.catalog | ForEach-Object {
  $_.produtosDireto
  $_.subcategorias | ForEach-Object { $_.produtos }
} | Where-Object name -eq 'Marmita do Dia')

$p.basePrice
$p.modifierGroups | Where-Object name -eq 'Escolha o Tamanho' |
  Select-Object name, pricingMode, options
```

Esperado: `basePrice = 0`, `pricingMode = substituir`, opções `18, 22, 25`.

### Verificação visual

Abrir o cardápio público e confirmar:

- card: `A partir de R$ 18,00`;
- P selecionado: `R$18,00`;
- M selecionado: `R$22,00`;
- G selecionado: `R$25,00`.

Se a API não trouxer `pricingMode`, o frontend não consegue aplicar essa regra. Corrigir o payload público e fazer deploy do backend + frontend.

## 2. Push concluído, produção antiga

Push e CI verdes não significam que o domínio está servindo o container novo.

### Checklist

```powershell
git status --short --branch
git log -1 --oneline --decorate
gh run list --repo kdo-vini/zelomenu --limit 3 --branch master
```

No Dokploy, conferir:

- repositório `kdo-vini/zelomenu`;
- branch `master`;
- deployment com o mesmo SHA do `HEAD`;
- status `done`;
- container novo `healthy`.

Depois disso, testar o domínio público. O bundle carregado e a API pública são a autoridade; não confiar apenas na tela de deployments.

## 3. Conflito de rota Traefik/Dokploy

### Sintoma

O container novo contém o código correto, mas `menu.zelopdv.com.br` continua retornando HTML/API do serviço antigo.

### Diagnóstico

No Dokploy, verificar **Docker → Containers**. Durante este incidente existiam:

```text
zelomenu-zelomenu-tapwm3  novo app Dokploy
zelomenu.1                serviço legado, rodando há semanas
```

Em **Traefik File System → dynamic**, conferir:

```text
zelomenu.yml
zelomenu-zelomenu-tapwm3.yml
```

O domínio só pode aparecer em uma rota ativa:

```text
Host(`menu.zelopdv.com.br`)
```

### Correção segura

1. Manter o app novo em execução.
2. Remover a rota do domínio do arquivo legado `zelomenu.yml`.
3. Não apagar o container legado sem verificar se ele atende outra rota.
4. Manter a rota no arquivo `zelomenu-zelomenu-tapwm3.yml`, apontando para:

```text
http://zelomenu-zelomenu-tapwm3:3101
```

5. Recarregar o Traefik.
6. Testar a API pública e o cardápio no navegador.

Para um arquivo legado sem rotas, usar `{}`. `http: {}` foi rejeitado pelo Traefik como configuração HTTP vazia inválida.

### Smoke test do domínio

```powershell
curl.exe -sS -i --max-time 20 `
  https://menu.zelopdv.com.br/api/public/zelomenu/store/bemservido
```

Esperado: `HTTP/1.1 200 OK`, `Cache-Control` do endpoint público e `pricingMode: "substituir"` no JSON.

Se retornar `404 page not found`, o Traefik está sem rota carregada. Se retornar JSON sem `pricingMode`, ainda está atendendo o serviço antigo.

## 4. Cache e deploy

`Clean Cache` é uma ferramenta de recuperação, não uma configuração permanente.

Usar quando:

- o Docker está reutilizando uma camada suspeita;
- dependências ou build args ficaram antigos;
- o bundle publicado não muda após rebuild.

Fluxo normal:

1. Autodeploy ligado.
2. Clean Cache desligado.
3. Rebuild/Deploy apenas quando necessário.
4. Depois do deploy, validar o domínio público.

Clean Cache não corrige conflito de roteamento Traefik.

## 5. Template para novos incidentes

```markdown
## AAAA-MM-DD — título curto

### Sintoma

### Impacto

### Evidência
- commit/deployment:
- endpoint público:
- container atendendo:
- screenshot/log:

### Causa raiz

### Correção aplicada

### Validação
- [ ] API pública
- [ ] bundle/frontend
- [ ] fluxo real no navegador
- [ ] container saudável

### Prevenção
```

## Regras para não repetir

- Diagnosticar banco, API pública, container e Traefik na mesma sequência.
- Não assumir que `push` equivale a produção atualizada.
- Não assumir que container novo equivale a domínio apontando para ele.
- Não corrigir preço substituto alterando o preço-base.
- Não remover container legado antes de retirar e validar a rota do domínio.
- Nunca registrar senhas ou tokens nesta documentação.
