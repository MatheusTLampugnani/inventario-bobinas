# Inventário de Bobinas — Videplast

Sistema web de alta performance desenvolvido sob medida para facilitar, agilizar e garantir a integridade do inventário físico e conciliação de estoque de bobinas industriais, comparando leituras reais com dados oficiais do SAP.

---

## Propósito do Projeto
O propósito principal deste sistema é cruzar de forma inteligente e em tempo real as informações físicas (bobinas localizadas no galpão logístico) com o arquivo de exportação oficial do sistema SAP. 

A aplicação identifica discrepâncias instantaneamente, apontando o status exato de cada lote:
- **OK (Lida):** Bobina esperada que foi bipada/lida fisicamente com sucesso.
- **Faltando:** Bobina cadastrada no SAP que ainda não foi encontrada no galpão.
- **Sobra (Não SAP):** Bobina encontrada e bipada no local físico, mas que não consta no planejamento importado do SAP.

---

## Funcionalidades Principais

### 1. Autenticação por Crachá Corporativo
- Validação rápida de crachás diretamente contra a base de dados integrada no Supabase.
- Geração automática de iniciais com **Avatar Dinâmico** estilizado para o painel do operador logado.

### 2. Importação SAP (CSV Inteligente)
- Upload de arquivos CSV exportados do SAP contendo a relação esperada.
- Leitura automatizada tolerante a codificações de caracteres (ISO-8859-1 / UTF-8) e delimitadores variados (`,` ou `;`).
- Extração de metadados como: *Lote, Material, Descrição, Depósito, Ordem de Produção, Ordem de Venda, Cliente, Nome do Cliente, Peso Líquido, Largura e Espessura*.

### 3. Métodos Avançados de Leitura (Tríplice Entrada)
- **Leitor de Código de Barras Físico:** Interface otimizada com campo de texto (`textarea` inteligente) tolerante a bipadas consecutivas separadas por espaços, vírgulas ou quebras de linha.
- **Câmera do Celular:** Scanner nativo embutido que usa a webcam ou a câmera traseira do smartphone (`facingMode: "environment"`) para capturar e decodificar códigos instantaneamente.
- **Processamento de Drone (Lote por Vídeo):** *[NOVO]* Módulo revolucionário que permite fazer upload de gravações em vídeo (MP4) capturadas por drones voando pelos corredores do estoque. O sistema analisa frame por frame a 1.5x de velocidade, extrai dezenas de códigos QR e códigos de barra simultaneamente em lote e realiza o **Bulk Insert** (inserção em massa) diretamente no banco de dados.

### 4. Responsividade Extrema & Mobile-First
- Desenvolvido especificamente para **telefones celulares**, o dispositivo primário dos operadores no galpão.
- **Visualização Híbrida de Relatórios:**
  - *Telas Grandes:* Exibe uma tabela clássica de conciliação com cabeçalho fixo escuro.
  - *Telas Móveis:* Oculta a tabela e exibe uma **Lista de Cards Verticais** que se encaixam perfeitamente na largura do celular, com badges coloridos e botões táteis dimensionados para evitar toques incorretos.

### 5. Estética Premium e Refinamento Visual
- **Interface Glassmorphism & Neon:** Efeitos de profundidade, sombras suaves e gradientes com o vermelho corporativo da Videplast.
- **Cards Estáveis (No-Hover):** Cards interativos de bipagem e importação mantêm-se estáticos durante a manipulação para evitar movimentos incômodos na tela de uso contínuo.
- **Contadores de Impacto:** Caixas de métricas com gradientes sutis e sombras coloridas difusas de acordo com o status (Esperadas, Lidas, Faltam).

### 6. Relatórios & Sincronização em Nuvem
- **Exportação Excel/CSV:** Gera planilhas completas com codificação `\uFEFF` (garantindo compatibilidade perfeita de acentos e caracteres especiais com o Microsoft Excel brasileiro) contendo todos os dados do SAP cruzados com quem bipou e o horário da leitura.
- **Sincronização Supabase:** Gravação automática em nuvem e sessionStorage persistente local para evitar qualquer perda de progresso em caso de recarregamento acidental ou oscilação de rede Wi-Fi/4G.

---

## Tecnologias Utilizadas

O ecossistema técnico foi planejado para carregamento instantâneo, portabilidade e desacoplamento:

- **Core & Componentes:** [React](https://react.dev/) + [Vite](https://vite.dev/) (Builds e HMR ultra velozes)
- **Banco de Dados & Back-end:** [Supabase](https://supabase.com/) (PostgreSQL BaaS com autenticação e persistência robusta)
- **Styling:** CSS Vanilla premium de alta performance + Bootstrap (via `react-bootstrap` para componentes estruturais de modal)
- **Biblioteca de Ícones:** Bootstrap Icons
- **Leitura via Câmera (Real-time):** [html5-qrcode](https://github.com/mebjas/html5-qrcode) (Acesso à câmera do dispositivo e decodificação)
- **Processamento de Drone (Visão computacional de QR):** [jsQR](https://github.com/cozmo/jsQR) (Varredura de frames de vídeo para decodificação em lote)
- **Animações Fluidas:** Animate.css

---
