-- 001 — Colunas que o app já envia na importação SAP + índices da conferência
--
-- Contexto: desde 30/06/2026 o app envia `romaneio` e `agrupador` ao gravar `bobinas_sap`,
-- mas essas colunas não existem. O PostgREST rejeitava o lote inteiro (PGRST204) e nenhuma
-- base SAP foi salva desde então. O app novo já contorna isso (descarta as colunas que faltam),
-- mas sem elas a conferência perde o vínculo por romaneio e o agrupador.
--
-- Seguro para rodar mais de uma vez. Não altera nem apaga dados existentes.
-- Aplicar em: Supabase > SQL Editor.

alter table public.bobinas_sap add column if not exists romaneio text;
alter table public.bobinas_sap add column if not exists agrupador text;

-- A conferência busca SAP por lote e por sessão, e leituras/sessões por período
create index if not exists idx_bobinas_sap_lote on public.bobinas_sap (lote);
create index if not exists idx_bobinas_sap_sessao on public.bobinas_sap (sessao_id);
create index if not exists idx_bobinas_lidas_data_leitura on public.bobinas_lidas (data_leitura);
create index if not exists idx_bobinas_lidas_sessao_lote on public.bobinas_lidas (sessao_id, lote);
create index if not exists idx_sessoes_inventario_data on public.sessoes_inventario (data_importacao);

-- Faz o PostgREST enxergar as colunas novas imediatamente
notify pgrst, 'reload schema';
