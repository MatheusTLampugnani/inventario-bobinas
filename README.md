# 📦 Inventário de Bobinas — Videplast

<div align="center">

**Sistema de Inventário Físico e Conciliação de Estoque com Inteligência Artificial**

![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.139-009688?logo=fastapi&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-BaaS-3ECF8E?logo=supabase&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Container-2496ED?logo=docker&logoColor=white)
![Render](https://img.shields.io/badge/Render-Deploy-46E3B7?logo=render&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)

</div>

---

## 📋 Índice

- [Visão Geral](#-visão-geral-da-solução)
- [Objetivos de Negócio](#-objetivos-de-negócio)
- [Arquitetura](#-arquitetura-atualizada)
- [Fluxos de Funcionamento](#-fluxos-de-funcionamento)
- [Componentes e Responsabilidades](#-componentes-e-responsabilidades)
- [Dependências e Integrações](#-dependências-e-integrações)
- [Requisitos Funcionais e Não Funcionais](#-requisitos-funcionais-e-não-funcionais)
- [Decisões Arquiteturais](#-decisões-arquiteturais-adotadas)
- [Padrões de Projeto](#-padrões-de-projeto-utilizados)
- [Estratégia de Segurança](#-estratégia-de-segurança)
- [Observabilidade](#-estratégia-de-observabilidade)
- [Deploy e Operação](#-processo-de-deploy-e-operação)
- [Melhorias Realizadas](#-melhorias-realizadas-desde-a-versão-inicial)
- [Limitações e Roadmap](#-limitações-conhecidas-e-roadmap-futuro)

---

## 🔭 Visão Geral da Solução

O **Inventário de Bobinas** é um sistema web de alta performance desenvolvido sob medida para a **Videplast** (grupo de embalagens flexíveis com múltiplas filiais no Brasil). A aplicação tem como objetivo central automatizar, agilizar e garantir a integridade do inventário físico de bobinas industriais, realizando a **conciliação em tempo real** entre as leituras físicas (obtidas por leitores de código de barras, câmeras de celular ou drones com IA) e os dados oficiais exportados do sistema **SAP**.

A solução opera como uma **Progressive Web App (PWA)** mobile-first, projetada para uso direto por operadores logísticos dentro de galpões industriais, com resiliência a oscilações de rede (Wi-Fi/4G) e interface otimizada para dispositivos touchscreen.

### Diagrama de Contexto (C4 — Nível 1)

```mermaid
C4Context
    title Sistema de Inventário de Bobinas — Contexto

    Person(operador, "Operador Logístico", "Realiza leituras de bobinas no galpão via celular ou leitor USB")
    Person(admin, "Administrador / Gestor", "Importa planilhas SAP, confere e exporta relatórios consolidados")
    Person(drone_op, "Operador de Drone", "Captura vídeos dos corredores para leitura em massa")

    System(inventario, "Sistema Inventário de Bobinas", "PWA React + Backend IA Python")

    System_Ext(sap, "SAP ERP", "Exporta planilhas CSV com dados de referência de estoque")
    System_Ext(supabase, "Supabase (PostgreSQL + Auth)", "BaaS - Persistência, autenticação e sincronização em nuvem")
    System_Ext(render, "Render Cloud", "Hospedagem do frontend estático e backend Docker")

    Rel(operador, inventario, "Bipa bobinas via celular, câmera ou leitor USB")
    Rel(admin, inventario, "Importa CSV SAP, gera relatórios, confere leituras")
    Rel(drone_op, inventario, "Envia vídeos para processamento por IA")
    Rel(inventario, supabase, "Persiste leituras, sessões, crachás e dados SAP")
    Rel(inventario, sap, "Importa CSV exportado manualmente")
    Rel(inventario, render, "Hospedado em produção")
```

---

## 🎯 Objetivos de Negócio

| # | Objetivo | Descrição |
|---|----------|-----------|
| 1 | **Redução do tempo de inventário** | Substituir processos manuais com papel por leituras digitais em tempo real, reduzindo o ciclo de inventário de dias para horas |
| 2 | **Acurácia de 100%** | Cruzamento inteligente entre dados físicos e SAP para identificar discrepâncias instantaneamente |
| 3 | **Rastreabilidade completa** | Registro de quem bipou, quando, onde e em qual sessão, para auditoria total |
| 4 | **Cobertura de múltiplas filiais** | Suporte nativo a 7 filiais (Videira, Manaus, Três Rios, União da Vitória, Rio Verde, Várzea Grande, Barracão do Lima) |
| 5 | **Escalabilidade de leitura** | Processamento em massa via vídeo de drone com visão computacional (YOLOv8 + ZXing) |
| 6 | **Operação mobile-first** | Sistema projetado para celulares em ambientes industriais ruidosos com conectividade instável |
| 7 | **Dual-mode de contagem** | Suporte a inventário por **Lote** (bobina individual) e por **Romaneio** (carga de expedição) |

---

## 🏗️ Arquitetura Atualizada

### Diagrama de Contêineres (C4 — Nível 2)

```mermaid
C4Container
    title Sistema de Inventário de Bobinas — Contêineres

    Person(user, "Operador / Admin")

    Container_Boundary(frontend_boundary, "Frontend - Static Site") {
        Container(spa, "SPA React", "React 19 + Vite 8", "Interface PWA mobile-first com lógica de negócio no cliente")
        Container(sw, "Service Worker", "JavaScript", "Cache offline e estratégia stale-while-revalidate")
    }

    Container_Boundary(backend_boundary, "Backend - Docker Container") {
        Container(api, "API de Processamento de Vídeo", "Python 3.12 + FastAPI", "Recebe vídeos, processa frames e decodifica QR codes via IA")
    }

    ContainerDb(supabase_db, "Supabase PostgreSQL", "PostgreSQL", "Armazena sessões, crachás, bobinas SAP e leituras")
    ContainerDb(session_storage, "SessionStorage", "Browser API", "Cache local para resiliência a desconexões")

    Rel(user, spa, "Interage via HTTPS")
    Rel(spa, supabase_db, "REST API (Supabase JS Client)")
    Rel(spa, api, "POST /api/processar-drone (upload de vídeo)")
    Rel(spa, session_storage, "Persistência local de estado")
    Rel(sw, spa, "Intercepta requisições de rede")
```

### Stack Tecnológico

| Camada | Tecnologia | Versão | Propósito |
|--------|-----------|--------|-----------|
| **Frontend** | React | 19.2 | UI reativa com hooks |
| **Build** | Vite | 8.0 | Bundler ultrarrápido com HMR |
| **UI Framework** | Bootstrap + React-Bootstrap | 5.3 / 2.10 | Layout responsivo e componentes prontos |
| **Ícones** | Bootstrap Icons + React-Bootstrap-Icons | 1.11 | Iconografia consistente |
| **Scanner** | html5-qrcode | 2.3.8 | Leitura de QR/Barcode via câmera do dispositivo |
| **BaaS** | Supabase (PostgreSQL) | 2.99 | Banco de dados, autenticação e API REST |
| **Backend IA** | Python + FastAPI | 3.12 / 0.139 | Microsserviço de processamento de vídeo |
| **Visão Computacional** | OpenCV + ZXing-C++ | 4.11 / 3.1 | Processamento de imagem e decodificação de códigos |
| **Containerização** | Docker | Python 3.12-slim | Empacotamento do backend |
| **Hospedagem** | Render | — | Static Site (frontend) + Web Service (backend) |
| **PWA** | Service Worker + Manifest | — | Instalável como app nativo |

---

## 🔄 Fluxos de Funcionamento

### Fluxo Principal de Inventário

```mermaid
stateDiagram-v2
    [*] --> Login: Operador informa crachá
    Login --> OCIOSO: Crachá validado no Supabase
    OCIOSO --> ESCOLHER_TIPO_CONTAGEM: Iniciar Inventário
    ESCOLHER_TIPO_CONTAGEM --> ESCOLHER_MODO: Seleciona LOTE ou ROMANEIO
    ESCOLHER_MODO --> INFORMAR_ENDERECO: Com Endereço
    ESCOLHER_MODO --> BIPANDO: Sem Endereço (Livre)
    INFORMAR_ENDERECO --> BIPANDO: Depósito + Gaveta confirmados
    
    state BIPANDO {
        [*] --> AguardandoLeitura
        AguardandoLeitura --> ProcessandoCodigo: Código digitado / câmera / drone
        ProcessandoCodigo --> ValidacaoRegras: Processa entrada em massa
        ValidacaoRegras --> GravaSupabase: Código válido
        ValidacaoRegras --> AlertaOperador: Código rejeitado
        GravaSupabase --> AtualizaUI: Sucesso
        AlertaOperador --> AguardandoLeitura
        AtualizaUI --> AguardandoLeitura
    }
    
    BIPANDO --> FinalizarGaveta: Próxima gaveta
    BIPANDO --> OCIOSO: Encerrar inventário
    FinalizarGaveta --> INFORMAR_ENDERECO: Nova gaveta
```

### Fluxo de Decisão — Identificação de Códigos (Modo LOTE)

```mermaid
graph TD
    A["Código Lido / Bipado"] --> B{"Qual o Modo de Contagem?"}
    
    B -->|"Modo: LOTE"| C{"Possui a tag VL\\d+LT?"}
    C -->|Sim| D["Extrai lotes da tag VL e descarta o resto"]
    C -->|Não| E{"Linha tem múltiplos termos?"}
    E -->|Sim| F["Ignorar Linha por Completo"]
    E -->|Não| G{"Palavra única começada com Letra?"}
    G -->|Sim| H["Tipo: LOTE — Mapeia filial por prefixo"]
    G -->|Não| I{"É identificador de agrupador AG/Número?"}
    I -->|Sim| J{"Planilha SAP Carregada?"}
    J -->|Sim| K["Expansão Dinâmica — Busca bobinas no SAP por agrupador"]
    J -->|Não| L["Descartar Código"]
    I -->|Não| M["Descartar Código"]
    
    B -->|"Modo: ROMANEIO"| N{"Possui a tag VL\\d+LT?"}
    N -->|Sim| O["Descartar — Pertence ao modo LOTE"]
    N -->|Não| P{"Possui a tag (7)?"}
    P -->|Sim| Q["Tipo: ROMANEIO — Extrai dígitos da tag 7"]
    P -->|Não| R["Aceitar se numérico com 6-12 dígitos"]
```

### Fluxo de Processamento de Drone (Otimizado)

```mermaid
sequenceDiagram
    participant Op as Operador
    participant FE as Frontend React
    participant BE as Backend FastAPI
    participant CV as OpenCV + ZXing
    
    Op->>FE: Seleciona vídeo (.MP4/.MOV)
    FE->>BE: POST /api/processar-drone (FormData)
    BE->>BE: Salva arquivo temporário
    
    loop Para cada frame amostrado (5 fps)
        BE->>CV: Extrai frame via cap.read()
        CV->>CV: Otimização: Redimensiona frame (max 1024px)
        CV->>CV: Filtro de movimento (delta > 0.5%)
        CV->>CV: Gera variações (Grayscale, CLAHE, Otsu, Adaptativo)
        CV->>CV: Decodifica com ZXing-C++
        CV-->>BE: Códigos encontrados no frame
        BE->>CV: Avança frames intermediários via cap.grab()
    end
    
    BE->>BE: Remove duplicatas (Set global)
    BE->>BE: Limpa arquivo temporário
    BE-->>FE: { sucesso: true, codigos: [...], total_encontrados: N }
    FE->>FE: processarEntradaMassa() em cada código
    FE->>FE: Filtra e valida por regras de negócio
    FE-->>Op: "Drone concluído! N novos itens inseridos."
```

---

## 🧩 Componentes e Responsabilidades

### Frontend (React SPA)

| Componente | Arquivo | Responsabilidade |
|-----------|---------|------------------|
| **App** | `src/App.jsx` | Componente raiz com toda a máquina de estados do inventário, lógica de negócio, importação CSV, conciliação e renderização condicional |
| **Header** | `src/components/Header.jsx` | Exibe logotipo corporativo da Videplast |
| **Scanner** | `src/components/Scanner.jsx` | Encapsula o `html5-qrcode` para leitura via câmera traseira (`facingMode: environment`) com tratamento de permissão e lifecycle seguro |
| **ProcessadorDrone** | `src/components/ProcessadorDrone.jsx` | Interface de upload de vídeo e comunicação com o backend de IA, com feedback de status em tempo real |
| **FilterControls** | `src/components/FilterControls.jsx` | Controles de filtro e ordenação para o painel de conferência administrativa |
| **Supabase Client** | `src/supabase.js` | Inicialização do cliente Supabase com variáveis de ambiente |

### Backend (Python FastAPI)

| Módulo | Arquivo | Responsabilidade |
|--------|---------|------------------|
| **API FastAPI** | `backend/main.py` | Endpoint `POST /api/processar-drone` para processamento de vídeo com visão computacional |
| **Variações de Imagem** | `gerar_variacoes_imagem()` | Pipeline de processamento de imagem com Threshold Adaptativo, CLAHE e Otsu |
| **Decodificador** | `decodificar_frame()` | Orquestrador de decodificação multi-variação com ZXing-C++ |

---

## 🔗 Dependências e Integrações

### Integrações Externas

| Sistema | Tipo | Protocolo | Descrição |
|---------|------|-----------|-----------|
| **SAP ERP** | Offline | CSV (`;` ou `,` delimitado) | Importação manual de planilhas com dados de referência de estoque |
| **Supabase** | Online | REST HTTPS | BaaS para persistência, autenticação de crachás e sincronização em nuvem |
| **Backend IA** | Online | REST HTTPS | Microsserviço de processamento de vídeo do drone |

### Tabelas Supabase (Modelo de Dados)

| Tabela | Descrição |
|--------|-----------|
| `crachas` | Cadastro de operadores (`id`, `nome_completo`, `admin`) |
| `sessoes_inventario` | Sessões de inventário (`id`, `cracha_importacao`, `status`) |
| `bobinas_sap` | Dados importados da planilha SAP (lote, romaneio, material, etc.) |
| `bobinas_lidas` | Registros de leituras realizadas pelos operadores |
| `depositos` | Cadastro de depósitos com flag `requer_endereco` |
| `rotas` | Cadastro de rotas logísticas |

---

## ✅ Requisitos Funcionais e Não Funcionais

### Requisitos Funcionais

| RF | Descrição |
|----|-----------|
| RF-01 | Autenticação por crachá corporativo contra base Supabase |
| RF-02 | Importação de CSV do SAP com detecção automática de encoding e delimitador |
| RF-03 | Leitura de códigos via leitor USB, câmera do celular e drone com IA |
| RF-04 | Contagem dual-mode: por Lote ou por Romaneio |
| RF-05 | Inventário com ou sem endereçamento (Depósito/Gôndola/Gaveta) |
| RF-06 | Conciliação automática com 4 status: OK, Faltando, Sobra, Local Incorreto |
| RF-07 | Exportação de relatório conciliado em CSV compatível com Excel brasileiro |
| RF-08 | Painel de conferência administrativa com filtros e paginação |
| RF-09 | Expansão dinâmica de agrupadores em lotes individuais |
| RF-10 | Mapeamento automático de filial por prefixo de lote |
| RF-11 | Suporte a rotas logísticas na contagem endereçada |

### Requisitos Não Funcionais

| RNF | Categoria | Descrição | Mecanismo |
|-----|-----------|-----------|-----------|
| RNF-01 | **Performance** | Tempo de bipagem < 500ms por código | Lógica local no frontend + insert assíncrono no Supabase |
| RNF-02 | **Disponibilidade** | Operação contínua mesmo com oscilação de rede | SessionStorage como fallback + Service Worker com cache |
| RNF-03 | **Usabilidade** | Interface otimizada para telas de 5" a 7" | Mobile-first design com cards verticais e botões táteis |
| RNF-04 | **Compatibilidade** | Suporte a Chrome, Safari e Samsung Internet | HTML5 standards + Bootstrap 5 responsivo |
| RNF-05 | **Escalabilidade** | Suporte a milhares de bobinas por sessão | Paginação de 50 itens + processamento em lote |
| RNF-06 | **Internacionalização** | Compatibilidade com encoding brasileiro | ISO-8859-1 / UTF-8 com BOM (`\uFEFF`) na exportação |

---

## 🧭 Decisões Arquiteturais Adotadas

### ADR-01: Lógica de Negócio no Frontend

**Decisão**: Toda a lógica de validação, parsing e conciliação reside no React (`App.jsx`).

**Justificativa**: O backend é um microsserviço stateless focado exclusivamente em visão computacional. Manter as regras de negócio no frontend permite operação parcial offline via SessionStorage e reduz a latência de validação a zero (sem round-trip de rede).

**Trade-off**: O frontend (`App.jsx`) é um componente monolítico de ~1700 linhas, o que impacta a manutenibilidade.

---

### ADR-02: Supabase como BaaS

**Decisão**: Utilizar Supabase (PostgreSQL gerenciado) em vez de backend customizado com ORM.

**Justificativa**: Reduz drasticamente o time-to-market ao eliminar a necessidade de construir API REST, autenticação e migrations. O Supabase JS Client oferece inserção e consulta direta do frontend com RLS (Row Level Security) disponível.

---

### ADR-03: PWA com Service Worker Manual

**Decisão**: Implementar Service Worker manualmente com estratégia stale-while-revalidate em vez de usar workbox ou vite-plugin-pwa.

**Justificativa**: Controle total sobre o cache de assets estáticos sem dependência de bibliotecas adicionais. A estratégia permite que o operador continue usando o app mesmo com rede instável no galpão.

---

### ADR-04: Processamento de Drone como Microsserviço Separado

**Decisão**: Backend Python com FastAPI containerizado em Docker, separado do frontend.

**Justificativa**: O processamento de vídeo com OpenCV e YOLOv8 requer dependências pesadas de sistema (libgl, g++, cmake) incompatíveis com um ambiente Node.js. A separação permite escalar o backend independentemente do frontend.

---

### ADR-05: ZXing-C++ em vez de ZXing-JS

**Decisão**: Utilizar `zxing-cpp` (binding Python para C++) no backend em vez de ZXing-JS.

**Justificativa**: Performance 10-50x superior na decodificação de códigos em frames de vídeo de alta resolução. Essencial para processar 5 frames/segundo de vídeos de drone com latência aceitável.

---

## 🔲 Padrões de Projeto Utilizados

| Padrão | Onde é Aplicado | Descrição |
|--------|-----------------|-----------|
| **State Machine** | `etapaInventario` | Máquina de estados finitos para controlar o fluxo de inventário (OCIOSO → ESCOLHER_TIPO → ESCOLHER_MODO → INFORMAR_ENDERECO → BIPANDO) |
| **Strategy** | `processarEntradaMassa()` | Algoritmo de parsing que alterna entre estratégia LOTE e ROMANEIO baseado em `tipoContagem` |
| **Observer** | `useEffect` hooks | Efeitos colaterais reativos para sincronização com SessionStorage e Supabase |
| **Facade** | `supabase.js` | Abstração simplificada do cliente Supabase para o restante da aplicação |
| **Pipeline/Chain** | `gerar_variacoes_imagem()` | Pipeline de processamento de imagem com variações sequenciais (Grayscale → CLAHE → Otsu → Adaptativo) |
| **Template Method** | `decodificar_frame()` | Orquestrador que aplica o pipeline de variações e tenta decodificar cada uma com ZXing |
| **Batch Processing** | `processarLoteDrone()` | Processamento em lote dos códigos retornados pelo drone com deduplicação e inserção em massa |

---

## 🔐 Estratégia de Segurança & Hardening

| Aspecto | Implementação / Detalhamento do Hardening |
|---------|-------------------------------------------|
| **Autenticação de API** | API Key obrigatória via cabeçalho `X-API-KEY` para requisições no backend de drone, protegendo contra uso não autorizado |
| **Autenticação de Operador** | Validação rápida de crachá contra tabela `crachas` no Supabase com atribuições de `admin` |
| **Controle de CORS** | Restrito para o domínio de produção oficial da Videplast no Render e localhost do ambiente de desenvolvimento |
| **Proteção de Uploads (DoS)** | Limite de tamanho de arquivo travado em **600MB** (lido em chunks) e whitelisting estrito de extensões permitidas (`.mp4`, `.mov`, `.avi`) |
| **Segurança contra Path Traversal** | Geração automática de UUID4 para nomear arquivos de vídeo temporários, prevenindo sobrescritas e injeção de caminhos |
| **Robustez de Dados (LGPD)** | Bloco `finally` estrutural garante o expurgo imediato do arquivo de vídeo temporário após processamento, sem persistência residual |
| **Sanitização de Dados (Anti-Injeção)** | Sanitização inteligente de caracteres especiais no backend via expressão regular, permitindo apenas formatos válidos (letras, números, delimitadores, parênteses do negócio) |
| **Transporte de Dados** | Tráfego estritamente via HTTPS (TLS 1.3) para acesso à câmera e comunicação segura com o Supabase e Microsserviço |

---

## 📊 Estratégia de Observabilidade

| Pilar | Implementação Atual | Cobertura |
|-------|---------------------|-----------|
| **Logs** | `console.error` / `console.warn` no frontend; `print()` no backend | ⚠️ Básica — sem agregação centralizada |
| **Métricas de Negócio** | Contadores em tela (Esperadas / Lidas / Faltam) | ✅ Visual em tempo real |
| **Rastreabilidade** | Cada leitura registra `cracha_leitura`, `created_at`, `sessao_id`, `deposito`, `endereco_lido`, `rota` | ✅ Auditoria completa |
| **Monitoramento de Infra** | Render Dashboard (eventos de deploy, logs de build, uptime) | ⚠️ Básico |
| **Alertas** | Não implementado | ❌ |

---

## 🚀 Processo de Deploy e Operação

### Frontend (Static Site — Render)

```bash
# Build local
npm run build   # Gera /dist com assets otimizados pelo Vite

# Deploy: O Render detecta push no branch principal e executa o build automaticamente
# Configuração no Render:
#   Build Command: npm install && npm run build
#   Publish Directory: dist
```

### Backend (Docker — Render Web Service)

```dockerfile
# Imagem base leve
FROM python:3.12-slim

# Dependências de sistema para OpenCV e ZXing-C++
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev cmake g++

# Instala dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
```

### Variáveis de Ambiente Necessárias

| Variável | Onde | Descrição |
|----------|------|-----------|
| `VITE_SUPABASE_URL` | Frontend | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Chave anônima/service_role do Supabase |
| `VITE_API_URL` | Frontend | URL do backend de processamento de drone |
| `PORT` | Backend | Porta HTTP (definida automaticamente pelo Render) |

---

## 📈 Melhorias Realizadas desde a Versão Inicial

| Versão | Melhoria | Impacto |
|--------|----------|---------|
| v2.1 | **Otimização de Processamento de Drone** | Downscaling inteligente para 1024px + avanço via `cap.grab()` (redução de até 80% do uso de CPU) |
| v2.0 | **Dual-mode de contagem** (Lote + Romaneio) | Suporte a novos fluxos operacionais de expedição |
| v2.0 | **Sistema de Rotas** | Possibilita validação cruzada de posição SAP com rota + gaveta |
| v2.0 | **Validação inteligente de endereço** | Cruzamento Rota-Gaveta vs Posição SAP para detecção de "Local Incorreto" |
| v2.0 | **Expansão dinâmica de agrupadores** | Leitura de um único QR code expande automaticamente em N lotes |
| v1.5 | **Processamento de drone com IA** | Leitura em massa via vídeo, eliminando bipagem manual corredor por corredor |
| v1.5 | **Pipeline de variações de imagem** | CLAHE + Otsu + Threshold Adaptativo para maximizar decodificação em condições adversas |
| v1.5 | **Filtro de movimento do drone** | Ignora frames estáticos (< 0.5% variação de pixels) para otimizar performance |
| v1.0 | **PWA com Service Worker** | App instalável com cache offline |
| v1.0 | **Visualização híbrida** | Tabela em desktop, cards verticais em mobile |
| v1.0 | **Design System Videplast** | Paleta corporativa (#e20909), glassmorphism, DM Sans/Mono |

---

## ⚠️ Limitações Conhecidas e Roadmap Futuro

### Limitações Atuais

| # | Limitação | Severidade | Descrição |
|---|-----------|-----------|-----------|
| L-01 | **Monolito frontend** | 🟡 Média | `App.jsx` com ~1700 linhas concentra toda a lógica — dificulta manutenção e testes |
| L-02 | **CORS permissivo** | 🔴 Alta | Backend aceita `allow_origins=["*"]` — deveria restringir ao domínio de produção |
| L-03 | **Sem autenticação JWT** | 🟡 Média | Login por crachá sem token — não há expiração de sessão |
| L-04 | **Sem testes automatizados** | 🟡 Média | Nenhum teste unitário ou de integração |
| L-05 | **Service Worker básico** | 🟢 Baixa | Cache apenas de assets estáticos, sem sincronização de dados offline |
| L-06 | **Sem CI/CD formal** | 🟡 Média | Deploy via Render auto-deploy sem pipeline de validação |
| L-07 | **Chave `service_role` no frontend** | 🔴 Alta | O `.env` utiliza `service_role` indevidamente no frontend |
| L-08 | **Sem rate limiting** | 🟡 Média | Backend de processamento de drone sem proteção contra abuso |

### Roadmap Futuro

| Prazo | Melhoria Planejada |
|-------|-------------------|
| **Q3 2026** | Refatoração do `App.jsx` em módulos menores com custom hooks |
| **Q3 2026** | Implementação de testes com Vitest + Testing Library |
| **Q4 2026** | Migração para `anon` key com Row Level Security (RLS) no Supabase |
| **Q4 2026** | Restringir CORS para domínios de produção |
| **Q1 2027** | Pipeline CI/CD com GitHub Actions (lint + test + build + deploy) |
| **Q1 2027** | Observabilidade com Sentry (frontend) e logging estruturado (backend) |
| **Q2 2027** | Modo offline completo com IndexedDB e sync automático |
| **Q2 2027** | Dashboard analítico com gráficos de progresso de inventário em tempo real |

---

## 🗂️ Mapeamento de Filiais

| Prefixo do Lote | Código da Filial | Nome da Unidade |
|:---:|:---:|:---|
| **MA** | `1003` | Manaus |
| **VA** | `1001` | Videira |
| **TA** | `1007` | Três Rios |
| **UA** ou **UV** | `1006` | União da Vitória |
| **RA** | `1005` | Rio Verde |
| **ZA** | `1009` | Várzea Grande |
| **FA** | `1010` | Barracão do Lima |
| Qualquer outro | `1001` | Videira (default) |

---

## 📄 Licença

Projeto proprietário — **Videplast Indústria de Embalagens Ltda.** — Todos os direitos reservados.
