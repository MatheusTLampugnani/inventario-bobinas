# Supabase — passos manuais do Inventário de Bobinas

Estes passos são feitos no painel do Supabase e não pelo app. Siga a ordem.

## 1. Rodar `migrations/001_bobinas_sap_romaneio_agrupador.sql` (já, sem risco)

O script cria as colunas `romaneio` e `agrupador` em `bobinas_sap` e os índices que a conferência usa.
Sem essas colunas, nenhuma importação SAP foi salva desde 30/06/2026.
O app novo já salva sem elas, mas ainda perde romaneio e agrupador.

Onde rodar: **SQL Editor > colar > Run**. Pode rodar de novo sem problema.

## 2. Trocar a chave do frontend (urgente)

O `.env` do frontend usa a chave **service_role** na variável `VITE_SUPABASE_ANON_KEY`.
Tudo que começa com `VITE_` vai para o JavaScript público do site.
Com essa chave, qualquer pessoa que abra o site tem acesso total a **todas** as tabelas do projeto, inclusive as de outros sistemas: `imobilizados`, `registros_portaria`, `pessoas_terceiras` e outras.

1. Em **Project Settings > API Keys**, copie a chave pública: `anon` (legado) ou `publishable` (`sb_publishable_...`).
2. Coloque essa chave em `VITE_SUPABASE_ANON_KEY` no `.env`, gere o build e publique.
3. Rode `migrations/002_rls_inventario_bobinas.sql`. Ele libera para a chave pública só o que o app usa.
4. Teste no app: login, bipagem, importação de planilha e conferência.
5. **Invalide a chave service_role exposada.** Ela foi publicada no site e nos pacotes `.tar.gz`.
   - Antes, confira se outros sistemas do mesmo projeto usam essa chave: portaria, imobilizados e sistema-rateios.
   - Se usam, troque a chave neles primeiro. Rotacionar o segredo JWT legado invalida `anon` e `service_role` juntas.
   - Com as chaves novas (`sb_secret_...` / `sb_publishable_...`) dá para desativar as legadas depois de migrar tudo.

Chave secreta (service_role / secret) só pode existir em backend no servidor. Nunca em variável `VITE_`.

## 3. Conferir o limite de linhas da API

Em **Project Settings > Data API > Max Rows**, este projeto está com 10.000 linhas.
O app novo pagina todas as consultas e não depende mais desse valor.
