# Inventário de Bobinas — Videplast

Sistema web de alta performance desenvolvido sob medida para facilitar, agilizar e garantir a integridade do inventário físico e conciliação de estoque de bobinas industriais, comparando leituras reais com dados oficiais do SAP.

---

## Propósito do Projeto
O propósito principal deste sistema é cruzar de forma inteligente e em tempo real as informações físicas (bobinas localizadas no galpão logístico) com o arquivo de exportação oficial do sistema SAP. 

A aplicação identifica discrepâncias instantaneamente, apontando o status exato de cada lote:
- **OK (Lida):** Bobina esperada que foi bipada/lida fisicamente com sucesso.
- **Faltando:** Bobina cadastrada no SAP que ainda não foi encontrada no galpão.
- **Sobra (Não SAP):** Bobina encontrada e bipada no local físico, mas que não consta no planejamento importado do SAP.
- **Local Incorreto (Divergência):** Bobina cadastrada no SAP que foi lida em um endereço ou gôndola diferente do planejado.

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
- **Câmera do Celular:** Scanner nativo embutido que usa a webcam ou a câmera traseira do smartphone (`facingMode: "environment"`) com conexão segura HTTPS para capturar e decodificar códigos instantaneamente.
- **Processamento de Drone (Lote por Vídeo):** Módulo de processamento que permite fazer upload de gravações em vídeo (.MP4 ou .MOV) capturadas por drones voando pelos corredores do estoque. O sistema analisa frame por frame, extrai dezenas de códigos simultaneamente em lote e realiza a inserção automática no banco de dados.

### 4. Responsividade Extrema & Mobile-First
- Desenvolvido especificamente para **telefones celulares**, o dispositivo primário dos operadores no galpão.
- **Visualização Híbrida de Relatórios:**
  - *Telas Grandes:* Exibe uma tabela clássica de conciliação com cabeçalho fixo escuro.
  - *Telas Móveis:* Oculta a tabela e exibe uma **Lista de Cards Verticais** que se encaixam na largura do celular, com badges coloridos e botões táteis dimensionados para evitar toques incorretos.

### 5. Estética Premium e Refinamento Visual
- **Interface Glassmorphism & Neon:** Efeitos de profundidade, sombras suaves e gradientes com o vermelho corporativo da Videplast.
- **Cards Estáveis (No-Hover):** Cards interativos de bipagem e importação mantêm-se estáticos durante a manipulação para evitar movimentos incômodos na tela de uso contínuo no celular.
- **Contadores de Impacto:** Caixas de métricas com gradientes sutis e sombras coloridas difusas de acordo com o status (Esperadas, Lidas, Faltam).

### 6. Relatórios & Sincronização em Nuvem
- **Exportação Excel/CSV:** Gera planilhas completas com codificação `\uFEFF` (garantindo compatibilidade perfeita de acentos e caracteres especiais com o Microsoft Excel brasileiro) contendo todos os dados do SAP cruzados com quem bipou e o horário da leitura.
- **Sincronização Supabase:** Gravação automática em nuvem e sessionStorage persistente local para evitar qualquer perda de progresso em caso de recarregamento acidental ou oscilação de rede Wi-Fi/4G.

---

## Regras de Negócio: Identificação Inteligente de Lotes e Romaneios
 
Para garantir que o operador no galpão logístico não precise classificar manualmente cada bipagem, o sistema possui uma inteligência no frontend que analisa a estrutura do código e os dados importados do SAP para determinar as leituras legítimas de **Lote** ou **Romaneio**, dependendo do modo de contagem selecionado.
 
### 1. Definições
*   **Lote (Código de Bobina):** Identificador exclusivo de uma bobina física de material produzida ou estocada. Sempre se inicia com uma Letra (MA, VA, RA, ZA, FA, TA, UA/UV, etc.).
*   **Romaneio (Número de Carga):** Código numérico de expedição. Nos QR Codes estruturados do canto superior direito (cabeçalho), o romaneio está **sempre** contido na tag **(7)** (ex: `E(0)302163(1)SEARA ALIM(2)9056863(3)SACO LISO PEBD TRANSP SEA(4)159.100(5)1.300(6)MIL(7)5001828142(8)...` extrai `5001828142`).
*   **Agrupador (QR Code Completo):** O QR Code completo contendo múltiplos lotes físicos no formato:
    `MA8010438 OP500794389AG1000764380VL4LTVA13131798 VA13131806 VA13131809 VA13131815KG126,84`
    O sistema identifica o agrupador pela presença da tag `VL\d+LT` e extrai os lotes a partir dela (apenas no modo LOTE).
 
---
 
### 2. Fluxo de Decisão: Como o sistema identifica e valida as Leituras?
 
```mermaid
graph TD
    A[Código Lido / Bipado] --> B{Qual o Modo de Contagem?}
    
    B -->|Modo: LOTE| C{Possui a tag de Lote VL\d+LT?}
    C -->|Sim| D[Algoritmo VL*<br/>*Extrai lotes da tag VL e descarta o resto*]
    C -->|Não| E{Linha tem múltiplos termos?}
    E -->|Sim| F[Ignorar Linha por Completo<br/>*Representa cabeçalho ou dados misturados*]
    E -->|Não| G{Palavra única começada com Letra?}
    G -->|Sim| H[Tipo: LOTE<br/>*Mapeia filial por prefixo*]
    G -->|Não| I{É identificador de agrupador AG/Número?}
    I -->|Sim| J{Planilha SAP Carregada?}
    J -->|Sim| K[Expansão Dinâmica<br/>*Busca bobinas no SAP por agrupador e insere seus Lotes*]
    J -->|Não| L[Descartar Código<br/>*Não começa com letra e SAP está vazio*]
    I -->|Não| M[Descartar Código]
    
    B -->|Modo: ROMANEIO| N{Possui a tag de Lote VL\d+LT?}
    N -->|Sim| O[Descartar Linha por Completo<br/>*Pertence ao modo LOTE*]
    N -->|Não| P{Possui a tag de Romaneio (7)?}
    P -->|Sim| Q[Tipo: ROMANEIO<br/>*Extrai os dígitos subsequentes à tag 7*]
    P -->|Não| R[Descartar Código<br/>*Romaneios só podem ser lidos via tag 7*]
```
 
---
 
### 3. Detalhamento dos Padrões de Regra de Negócio
 
#### A. Identificação da Tag de Lotes (Modo LOTE)
*   **Padrão de Lote original (Videplast):** Contém a tag delimitadora `VL\d+LT` (ex: `VL1LT`, `VL2LT`, `VL4LT`).
*   **Comportamento Ultra-Robusto:** O frontend encontra dinamicamente o final da tag `VL\d+LT` e extrai todos os lotes subsequentes, limpando de forma tolerante a palavra `KG` e o peso se estiverem colados.
 
#### B. Identificação da Tag de Romaneio (Modo ROMANEIO)
*   **Padrão de Romaneio (Cabeçalho):** Identificado pela presença da tag `(7)` seguida de dígitos.
*   **Comportamento:** O sistema executa o regex `/\\(7\\)(\\d+)/i` para capturar o código numérico associado. Leituras manuais ou sem a tag (7) são completamente descartadas.
 
#### C. Expansão Dinâmica de Agrupador (Modo LOTE)
Se o termo bipado for um identificador de agrupador (como `AG1000764380` ou `1000764380`), o sistema executa uma **Expansão Dinâmica**:
1. Busca todas as bobinas do SAP importado que possuem esse agrupador.
2. Insere todos os lotes correspondentes daquelas bobinas de forma automática.

---

## Mapeamento de Filiais

A aplicação do frontend ([App.jsx](file:///c:/Users/wanderson.oliveira/Desktop/inventario/src/App.jsx)) mapeia as filiais e seus respectivos prefixos de lote para facilitar o filtro e a organização da conferência:

| Prefixo do Lote | Código da Filial | Nome da Unidade |
| :--- | :--- | :--- |
| **MA** | `1003` | Manaus |
| **VA** | `1001` | Videira |
| **TA** | `1007` | Três Rios |
| **UA** ou **UV** | `1006` | União da Vitória |
| **RA** | `1005` | Rio Verde |
| **ZA** | `1009` | Várzea Grande |
| **FA** | `1010` | Barracão do Lima |
| Qualquer outra letra de Lote | `1001` | Videira |

---

## Regra de Consistência e Prevenção de Erros Operacionais
 
Para evitar erros operacionais e garantir a integridade total do inventário físico de bobinas, o sistema valida rigorosamente cada leitura no frontend:
*   Apenas códigos identificados como Lotes Físicos (iniciados com letra ou expandidos via base SAP) são gravados e salvos.
*   Leituras incompatíveis (como ordens de produção OP ou códigos numéricos soltos de sobra sem base SAP) são automaticamente rejeitadas com um alerta explicativo para o operador.
*   Isso garante integridade total dos relatórios de conciliação exportados por Lote.
 
---
 
## Regras no Backend (Processamento de Vídeos do Drone)
 
O microsserviço Python ([main.py](file:///c:/Users/wanderson.oliveira/Desktop/inventario/backend/main.py)) que processa os frames de vídeo capturados por drones nos corredores atua como um decodificador bruto de alta precisão.
*   **Amostragem Otimizada:** Processa **5 frames por segundo** de vídeo para garantir que bobinas gravadas rapidamente não sejam puladas.
*   **Filtro Dinâmico Estático:** Ignora frames estáticos caso a mudança de intensidade de pixels seja inferior a **0.5%** (permitindo capturar deslocamentos sutis do drone).
*   **Visão Computacional & IA:** Utiliza YOLOv8 para localizar a bounding box dos códigos no frame com limite de confiança reduzido para **0.15** (para pegar bobinas distantes ou inclinadas).
*   **Decodificação ZXing:** Recorta os frames, aplica operadores de contraste (CLAHE), super-resolução (Cubic Interpolation) e decodifica via ZXing-C++.
*   **Filtro Global de Frame:** Além dos recortes, faz leitura nativa no frame inteiro como redundância para capturar códigos nítidos que a IA do YOLO possa ter ignorado.
*   **Retorno de Dados:** Retorna as strings dos QR codes originais decodificados diretamente para o frontend, centralizando as validações de consistência e regras de negócio no React.
