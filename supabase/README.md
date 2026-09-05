# Banco compartilhado: autoridade única no ZeloPDV

As migrations históricas deste repositório são preservadas para referência e testes de contrato. **Não executar `supabase db push` a partir de ZeloMenu.** O ledger e toda migration nova pertencem a `kdo-vini/zelopdv/supabase/migrations`.

Os arquivos em `tests/fixtures` são espelhos de teste, não outro histórico aplicável. O header e `canonical-migrations.json` registram origem e SHA256 (UTF-8/LF). `npm run test:sql` verifica o hash do espelho e, quando o checkout PDV irmão está disponível, verifica também o arquivo canônico. Para atualizar: copie o corpo canônico revisado, atualize ambos os hashes, rode os testes e peça revisão do diff SQL. CI sem checkout PDV verifica a integridade do espelho versionado; não afirma ter consultado um remoto privado.

`npm run test:sql` usa PostgreSQL WASM isolado. `PG_TEST_URL=postgres://...@127.0.0.1:5432/zelomenu_test npm run test:sql:postgres` exige banco local vazio e verifica locks entre dois backends PostgreSQL reais. O script recusa host remoto e banco fora de `zelomenu_test*`; não destrói schema para reutilizar banco. CI fornece PostgreSQL17 descartável.

As fixtures modelam somente dependências dos casos exercitados; não equivalem ao schema/RLS inteiro nem testam entrega externa, pagamentos, push de verdade ou impressora. A função `create_zelo_order` e o helper de resultado foram lidos via CLI em 2026-09-04; alterações canônicas futuras exigem atualizar esta referência.

As sete migrations de autoridade conversacional recebidas do upstream ficam em `history/conversation-ordering/`, fora da descoberta de migrations da CLI, por colidirem com o ledger canônico. Os hashes e as origens foram preservados no README dessa pasta.
