-- 002 — Row Level Security das tabelas do Inventário de Bobinas
--
-- APLIQUE SÓ DEPOIS de trocar a chave do frontend para a chave pública (anon / publishable).
-- Hoje o frontend usa a chave service_role, que ignora RLS: com ela estas regras não têm efeito.
-- Ordem: ver supabase/README.md.
--
-- O que fica permitido para a chave pública (role anon), exatamente o que o app usa:
--   depositos, rotas ........ ler
--   sessoes_inventario ...... ler, criar
--   bobinas_sap ............. ler, criar
--   bobinas_lidas ........... ler, criar, excluir leituras dos últimos 2 dias (botão de lixeira)
-- Nada de UPDATE, nem DELETE fora disso, nem acesso às demais tabelas do projeto.
--
-- `crachas` NÃO está aqui de propósito: a tabela parece compartilhada com outros sistemas do
-- mesmo projeto (portaria, imobilizados). Ver o bloco opcional no fim do arquivo.

alter table public.depositos enable row level security;
alter table public.rotas enable row level security;
alter table public.sessoes_inventario enable row level security;
alter table public.bobinas_sap enable row level security;
alter table public.bobinas_lidas enable row level security;

drop policy if exists "inventario_ler_depositos" on public.depositos;
create policy "inventario_ler_depositos" on public.depositos for select to anon using (true);

drop policy if exists "inventario_ler_rotas" on public.rotas;
create policy "inventario_ler_rotas" on public.rotas for select to anon using (true);

drop policy if exists "inventario_ler_sessoes" on public.sessoes_inventario;
create policy "inventario_ler_sessoes" on public.sessoes_inventario for select to anon using (true);
drop policy if exists "inventario_criar_sessoes" on public.sessoes_inventario;
create policy "inventario_criar_sessoes" on public.sessoes_inventario for insert to anon with check (true);

drop policy if exists "inventario_ler_sap" on public.bobinas_sap;
create policy "inventario_ler_sap" on public.bobinas_sap for select to anon using (true);
drop policy if exists "inventario_criar_sap" on public.bobinas_sap;
create policy "inventario_criar_sap" on public.bobinas_sap for insert to anon with check (true);

drop policy if exists "inventario_ler_leituras" on public.bobinas_lidas;
create policy "inventario_ler_leituras" on public.bobinas_lidas for select to anon using (true);
drop policy if exists "inventario_criar_leituras" on public.bobinas_lidas;
create policy "inventario_criar_leituras" on public.bobinas_lidas for insert to anon with check (true);
drop policy if exists "inventario_excluir_leituras_recentes" on public.bobinas_lidas;
create policy "inventario_excluir_leituras_recentes" on public.bobinas_lidas for delete to anon
  using (data_leitura > now() - interval '2 days');

-- ---------------------------------------------------------------------------------------------
-- OPCIONAL — crachas. Antes de aplicar, confirme que nenhum outro sistema usa `crachas` com a
-- chave pública de um jeito que estas regras bloqueiem (ex.: cadastro/edição de crachás).
-- O app de bobinas só precisa LER id, nome_completo, admin, setor e unidade.
--
-- alter table public.crachas enable row level security;
-- drop policy if exists "inventario_ler_crachas" on public.crachas;
-- create policy "inventario_ler_crachas" on public.crachas for select to anon using (true);
-- ---------------------------------------------------------------------------------------------
