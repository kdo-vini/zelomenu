-- ZeloMenu branding images (logo + cover) no bucket "logos".
-- Políticas para o prefixo zelomenu-branding/ no bucket "logos".
-- NOTA: RLS precisa estar ativo em storage.objects para as políticas
-- terem efeito. Se o RLS já estiver ativo, as políticas passam a valer
-- imediatamente. Se não estiver, basta ativar via dashboard:
--   Storage → Policies → Enable RLS

do $$ begin
  create policy "zelomenu_branding_select" on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'logos' and (storage.foldername(name))[1] = 'zelomenu-branding');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create policy "zelomenu_branding_insert" on storage.objects for insert
    to anon, authenticated
    with check (bucket_id = 'logos' and (storage.foldername(name))[1] = 'zelomenu-branding');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create policy "zelomenu_branding_delete" on storage.objects for delete
    to anon, authenticated
    using (bucket_id = 'logos' and (storage.foldername(name))[1] = 'zelomenu-branding');
exception
  when duplicate_object then null;
end $$;
