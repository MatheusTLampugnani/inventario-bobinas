# Inventário de Bobinas

## Propósito do Projeto
Este projeto é um sistema web desenvolvido para facilitar e automatizar o processo de inventário e conferência de bobinas. O seu propósito principal é permitir que os operadores de estoque ou produção cruzem as informações físicas (bobinas bipadas/lidas no local) com a base de dados oficial gerada pelo sistema SAP. 

O sistema identifica rapidamente discrepâncias, mostrando quais bobinas foram lidas com sucesso, quais estão faltando e quais foram encontradas fisicamente mas não constam no sistema SAP, garantindo assim a integridade e precisão do inventário.

## Funcionalidades Principais

* **Autenticação Simples (Crachá):** O acesso ao sistema é feito através da inserção do número do crachá do operador, com validação de identidade diretamente no banco de dados.
* **Importação de Dados SAP (CSV):** Permite o upload de um arquivo CSV exportado do SAP contendo a relação de bobinas esperadas para o inventário. O sistema extrai automaticamente dados como Lote, Material, Ordem de Produção, Cliente, Peso, entre outros.
* **Leitura de Bobinas:**
  * **Leitor de Código de Barras / Digitação:** Entrada rápida do código/lote da bobina através de leitores USB/Bluetooth ou digitação manual.
  * **Leitura via Câmera:** Integração nativa para ler códigos de barras utilizando a câmera do dispositivo móvel ou webcam.
* **Validação em Tempo Real:** Ao ler uma bobina, o sistema cruza imediatamente a informação com a base do SAP, alertando o operador caso a bobina já tenha sido lida ou se ela não constar na lista de bobinas esperadas.
* **Dashboard de Acompanhamento:** Exibição clara das métricas do inventário em andamento:
  * Quantidade de bobinas **Esperadas**.
  * Quantidade de bobinas **Lidas**.
  * Quantidade de bobinas que **Faltam**.
* **Tela de Conferência:** Um modal dedicado onde o operador pode visualizar, pesquisar (por lote ou data) e ordenar todas as leituras que ele realizou.
* **Geração de Relatórios:** Exportação de um relatório consolidado completo em formato CSV. O relatório detalha o status de cada bobina (OK, Faltando, ou Sobrando) juntamente com todas as suas informações do SAP e dados de quem realizou a leitura.
* **Sincronização em Nuvem:** Os dados da sessão de inventário, o arquivo do SAP e as bobinas lidas são salvos em tempo real em um banco de dados (Supabase), prevenindo perda de informações.

## Tecnologias Utilizadas

O sistema foi construído focando em performance, responsividade e facilidade de uso em dispositivos móveis e desktops.

* **Frontend:** React (inicializado com Vite)
* **Estilização e UI:** CSS Vanilla e Bootstrap (via `react-bootstrap` e `bootstrap`) para componentes responsivos e ícones (`react-bootstrap-icons`).
* **Backend / Banco de Dados (BaaS):** Supabase (armazenamento das sessões, crachás, bobinas do SAP e bobinas lidas).
* **Leitura de Câmera:** `html5-qrcode` para decodificação de códigos diretamente no navegador.
