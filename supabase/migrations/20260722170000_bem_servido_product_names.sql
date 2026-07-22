-- ZeloMenu — padronização de nomes de produtos: Bem Servido
-- Corrige capitalização, ortografia e padronização dos produtos
-- que serão exibidos no cardápio digital (zelomenu).
-- Escopo: user_id = 236ab3f6-5212-4910-956e-07185cdaf1f3

-- ─── Mamitas ────────────────────────────────────────────────────────────────────
update public.produtos set nome = 'Dobradinha G'       where id = 186 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Dobradinha M'       where id = 185 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Dobradinha P'       where id = 184 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Porção de Arroz (G)' where id = 241 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Porção de Arroz (M)' where id = 240 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Porção de Arroz (P)' where id = 239 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Refeição G'         where id = 189 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Refeição M'         where id = 188 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Refeição P'         where id = 187 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Salada (M)'         where id = 246 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Caldos ─────────────────────────────────────────────────────────────────────
update public.produtos set nome = 'Caldo de Feijão com Calabresa' where id = 212 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Caldo de Mandioca com Pedaços' where id = 211 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Caldo de Mocotó com Pedaços'   where id = 210 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Massas ─────────────────────────────────────────────────────────────────────
update public.produtos set nome = 'Kit Lasanha com Arroz e Saladinha' where id = 238 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Lasanha 500ml'                     where id = 237 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Yakisoba Grande Misto'             where id = 657 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Yakisoba Médio Carne ou Frango'   where id = 654 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Yakisoba Grande Carne ou Frango'  where id = 656 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Yakisoba Misto Médio'             where id = 655 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Bebidas ────────────────────────────────────────────────────────────────────
update public.produtos set nome = 'Coca-Cola 600ml'            where id = 215 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Coca-Cola 2 Litros'        where id = 217 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Coca-Cola Zero 600ml'      where id = 254 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Salgados ───────────────────────────────────────────────────────────────────
update public.produtos set nome = 'Combo c/ 20'     where id = 233 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Combo c/ 25'     where id = 234 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Mini Unidade'    where id = 232 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Torta de Frango' where id = 236 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Entrega ────────────────────────────────────────────────────────────────────
update public.produtos set nome = 'Entrega Bela Vista' where id = 658 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Entrega na Cidade'  where id = 248 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Entrega na Marfrig' where id = 249 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Filés à Parmegiana ────────────────────────────────────────────────────────
update public.produtos set nome = 'Filé à Parmegiana com Arroz' where id = 251 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Filé à Parmegiana Completo'  where id = 250 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Filé à Parmegiana Média'     where id = 252 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Filé à Parmegiana Solo'      where id = 253 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Lanches Tradicionais ──────────────────────────────────────────────────────
update public.produtos set nome = 'Filé de Frango Bacon'  where id = 207 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Filé de Frango Salada' where id = 206 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Filé de Frango Tudo'   where id = 208 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Diferente'           where id = 228 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Salada'              where id = 223 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Bacon'               where id = 225 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Burger'              where id = 222 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Calabresa'           where id = 227 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Egg'                 where id = 230 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Egg Salada'          where id = 231 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Salada Bacon'        where id = 226 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Salada Calabresa'    where id = 224 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'X-Tudo'                where id = 229 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';

-- ─── Artesanais ─────────────────────────────────────────────────────────────────
update public.produtos set nome = 'Lanche Frio de Atum'            where id = 243 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Lanche Frio de Frango'          where id = 242 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Lanche Frio de Presunto e Queijo' where id = 244 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
update public.produtos set nome = 'Lanche para Revenda'            where id = 245 and id_usuario = '236ab3f6-5212-4910-956e-07185cdaf1f3';
