# Referência histórica — não aplicar

Origem: `kdo-vini/zelomenu`, commit upstream `a619d022b3baef3d0c6b2b4f5fc885f7ace40b8f`, antes em `supabase/migrations/`.

Os sete arquivos foram movidos sem alteração de conteúdo. O SHA256 abaixo corresponde aos bytes do blob Git (LF); a movimentação local também verificou igualdade de hash antes/depois. Testes de contrato podem ler estes arquivos, mas a Supabase CLI não deve descobri-los como migrations executáveis.

A leitura CLI de 2026-09-04 confirmou que as RPCs usadas pelo código reconciliado já existem e negam EXECUTE a anon/authenticated. Os timestamps `20260902130000` e `20260902140000` pertencem no ledger live a `gerente_agent_foundation` e `gerente_phone_links` do PDV, respectivamente. Não alterar esse ledger e não renumerar/reaplicar estes arquivos: toda evolução de banco deve ser uma migration forward-only no ZeloPDV canônico.

| Arquivo de origem | SHA256 blob Git |
| --- | --- |
| `20260902110000_conversation_ordering_partial_snapshots.sql` | `a2ec44ff8633be7e205783d132fbac21e0ab6604523f0cd4dd067307ecbdf0ed` |
| `20260902120000_whatsapp_materializer_component_parity.sql` | `3f7759c0989786438ba9f2ce0f82132dbf72feb4c2557449b6c07941e592250d` |
| `20260902130000_fence_conversation_ordering_with_ai_epoch.sql` | `6834df21158fd8534468af984977b8c0d8f4e69c8ea88a31f676bf292539b948` |
| `20260902140000_harden_conversation_confirmation_authority.sql` | `300bb23653f5c531c63a120daeb1d1f2e6da0396730459fe629ef29fe8d35a28` |
| `20260904090000_require_whatsapp_zelo_confirmation_token.sql` | `499fcd3e1d19d001c888839dcc347e550dffd167a1eb89e5ad920a9c3d931749` |
| `20260904100000_verify_whatsapp_confirmation_replay_token.sql` | `db83d0b15f6a959e3dd562fee24a4e62d5909374e37508e57a407954ba2d65c0` |
| `20260904110000_hide_mismatched_whatsapp_session.sql` | `6851705992d0c40ce05fc5cef45c4570547455c2d1a0aaa2fd1d98d98db8aca0` |
