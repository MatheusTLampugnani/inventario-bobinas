import React, { useState, useEffect } from 'react';

const URL_ATUAL_FIXA = "https://monthly-meat-lounge-spelling.trycloudflare.com";

const ProcessadorDroneTurbo = ({ aoConcluir, aoCancelar }) => {
    // Prioriza a URL_ATUAL_FIXA atualizada pelo script automatizado a cada inicialização
    const apiPadrao = URL_ATUAL_FIXA || import.meta.env.VITE_API_URL;
    const [urlApi, setUrlApi] = useState(() => {
        const custom = localStorage.getItem("VITE_API_URL_CUSTOM");
        // Auto-limpa URLs antigas do trycloudflare salvas em navegadores de operadores
        if (custom && custom.includes("trycloudflare.com") && custom !== URL_ATUAL_FIXA) {
            localStorage.setItem("VITE_API_URL_CUSTOM", URL_ATUAL_FIXA);
            return URL_ATUAL_FIXA;
        }
        return custom || apiPadrao;
    });
    const [mostrarConfigUrl, setMostrarConfigUrl] = useState(false);
    const [statusBackend, setStatusBackend] = useState('checando'); // 'online' | 'offline' | 'checando'
    const [modoEnvio, setModoEnvio] = useState('upload'); // 'upload' | 'local_folder'
    
    // Estados do Modo Upload
    const [arquivo, setArquivo] = useState(null);

    // Estados do Modo Pasta Local
    const [videosLocais, setVideosLocais] = useState([]);
    const [caminhoPastaLocal, setCaminhoPastaLocal] = useState('');
    const [videoLocalSelecionado, setVideoLocalSelecionado] = useState('');
    const [carregandoVideosLocais, setCarregandoVideosLocais] = useState(false);

    const [processando, setProcessando] = useState(false);
    const [status, setStatus] = useState('');
    const [resultado, setResultado] = useState(null);
    const [tempoTotalEspera, setTempoTotalEspera] = useState(0);

    const testarConexaoBackend = async (targetUrl) => {
        setStatusBackend('checando');
        const baseUrl = (targetUrl || urlApi || apiPadrao).trim().replace(/\/+$/, '');
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const res = await fetch(`${baseUrl}/api/health`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res && res.ok) {
                const data = await res.json().catch(() => null);
                if (data && data.status === 'online') {
                    setStatusBackend('online');
                    return;
                }
            }
            setStatusBackend('offline');
        } catch (e) {
            setStatusBackend('offline');
        }
    };

    const carregarVideosLocais = async () => {
        setCarregandoVideosLocais(true);
        const API_URL = (urlApi || apiPadrao).trim().replace(/\/+$/, '');
        const API_KEY = import.meta.env.VITE_API_KEY || "videplast_segredo_padrao_2026";

        try {
            const res = await fetch(`${API_URL}/api/videos-locais`, {
                method: 'GET',
                headers: {
                    'X-API-KEY': API_KEY,
                    'Accept': 'application/json'
                }
            });
            if (res.ok) {
                const data = await res.json();
                setVideosLocais(data.arquivos || []);
                setCaminhoPastaLocal(data.caminho_pasta || '');
                if (data.arquivos && data.arquivos.length > 0) {
                    setVideoLocalSelecionado(data.arquivos[0].nome);
                }
            }
        } catch (e) {
            console.error("Erro ao listar vídeos locais:", e);
        } finally {
            setCarregandoVideosLocais(false);
        }
    };

    useEffect(() => {
        testarConexaoBackend(urlApi);
    }, [urlApi]);

    useEffect(() => {
        if (modoEnvio === 'local_folder' && statusBackend === 'online') {
            carregarVideosLocais();
        }
    }, [modoEnvio, statusBackend]);

    const salvarUrlCustomizada = (novaUrl) => {
        const urlSanitizada = novaUrl.trim().replace(/\/+$/, '');
        setUrlApi(urlSanitizada);
        localStorage.setItem("VITE_API_URL_CUSTOM", urlSanitizada);
        testarConexaoBackend(urlSanitizada);
    };

    const lidarComUploadVideo = (e) => {
        const file = e.target.files[0];
        if (file) {
            setArquivo(file);
            setResultado(null);
        }
    };

    const monitorarProgresso = (taskId, API_URL, API_KEY, tInicio) => {
        const intervalId = setInterval(async () => {
            try {
                const res = await fetch(`${API_URL}/api/status-drone/${taskId}`, {
                    method: 'GET',
                    headers: {
                        'X-API-KEY': API_KEY,
                        'Accept': 'application/json'
                    }
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'processando') {
                        const pct = data.porcentagem || 0;
                        const total = data.total_encontrados || 0;
                        setStatus(`Analisando vídeo de IA: ${pct}% concluído (${total} lotes encontrados até agora)...`);
                    } else if (data.status === 'concluido') {
                        clearInterval(intervalId);
                        const tTotal = (Date.now() - tInicio) / 1000;
                        setTempoTotalEspera(tTotal);
                        setResultado(data);
                        setStatus(`Sucesso! ${data.total_encontrados} códigos lidos.`);
                        setProcessando(false);
                    } else if (data.status === 'erro') {
                        clearInterval(intervalId);
                        setProcessando(false);
                        alert("Erro ao processar vídeo: " + (data.erro || "Falha desconhecida."));
                        setStatus('Erro no processamento.');
                    }
                }
            } catch (e) {
                console.error("Erro no polling de status:", e);
            }
        }, 1500);
    };

    const processarVideoLocal = async () => {
        if (!videoLocalSelecionado) return;
        setProcessando(true);
        setStatus('Iniciando análise direta no disco local (0s upload)...');
        const tInicio = Date.now();

        const API_URL = (urlApi || apiPadrao).trim().replace(/\/+$/, '');
        const API_KEY = import.meta.env.VITE_API_KEY || "videplast_segredo_padrao_2026";

        try {
            const res = await fetch(`${API_URL}/api/processar-drone-local`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': API_KEY
                },
                body: JSON.stringify({ filename: videoLocalSelecionado })
            });

            if (res.ok) {
                const dados = await res.json();
                if (dados.task_id) {
                    monitorarProgresso(dados.task_id, API_URL, API_KEY, tInicio);
                } else {
                    const tTotal = (Date.now() - tInicio) / 1000;
                    setTempoTotalEspera(tTotal);
                    setResultado(dados);
                    setStatus(`Sucesso! ${dados.total_encontrados} códigos lidos.`);
                    setProcessando(false);
                }
            } else {
                const errData = await res.json().catch(() => null);
                throw new Error(errData?.detail || `Erro HTTP ${res.status}`);
            }
        } catch (erro) {
            console.error(erro);
            alert("Erro ao processar vídeo local: " + erro.message);
            setStatus('Erro no processamento.');
            setProcessando(false);
        }
    };

    const enviarParaServidor = async () => {
        if (!arquivo) return;
        setProcessando(true);
        setStatus('Preparando envio do arquivo...');
        const tInicio = Date.now();

        const formData = new FormData();
        formData.append("file", arquivo);

        const API_URL = (urlApi || apiPadrao).trim().replace(/\/+$/, '');
        const API_KEY = import.meta.env.VITE_API_KEY || "videplast_segredo_padrao_2026";

        const uploadComProgresso = () => {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.upload.onprogress = (evento) => {
                    if (evento.lengthComputable) {
                        const porcentagem = Math.round((evento.loaded / evento.total) * 100);
                        const tamanhoEnviado = (evento.loaded / (1024 * 1024)).toFixed(1);
                        const tamanhoTotal = (evento.total / (1024 * 1024)).toFixed(1);
                        setStatus(`Enviando vídeo: ${porcentagem}% (${tamanhoEnviado}MB de ${tamanhoTotal}MB)...`);
                    }
                };

                xhr.upload.onload = () => {
                    setStatus('Upload concluído! Iniciando análise de Visão Computacional...');
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            const dados = JSON.parse(xhr.responseText);
                            resolve(dados);
                        } catch (e) {
                            reject(new Error("Resposta inválida do servidor."));
                        }
                    } else if (xhr.status === 413) {
                        reject(new Error("O vídeo é muito pesado para o túnel. Limite de 100MB excedido no Cloudflare."));
                    } else {
                        reject(new Error(`Falha no servidor (Código HTTP: ${xhr.status}).`));
                    }
                };

                xhr.onerror = () => {
                    setMostrarConfigUrl(true);
                    reject(new Error("Erro de conexão com a API. Verifique a internet ou configure a nova URL do túnel nas opções abaixo."));
                };

                xhr.ontimeout = () => {
                    reject(new Error("O tempo limite de envio esgotou. A rede móvel está muito lenta para este arquivo."));
                };

                xhr.open("POST", `${API_URL}/api/processar-drone`);
                xhr.setRequestHeader("X-API-KEY", API_KEY);
                xhr.timeout = 300000; 
                xhr.send(formData);
            });
        };

        try {
            const dados = await uploadComProgresso();
            if (dados.task_id) {
                monitorarProgresso(dados.task_id, API_URL, API_KEY, tInicio);
            } else {
                const tTotal = (Date.now() - tInicio) / 1000;
                setTempoTotalEspera(tTotal);
                setResultado(dados);
                setStatus(`Sucesso! ${dados.total_encontrados} códigos lidos.`);
                setProcessando(false);
            }
        } catch (erro) {
            console.error(erro);
            alert("Erro ao processar vídeo: " + erro.message);
            setStatus('Erro no processamento.');
            setProcessando(false);
        }
    };

    const formatarTempo = (segundos) => {
        const mins = Math.floor(segundos / 60);
        const segs = Math.floor(segundos % 60);
        if (mins > 0) {
            return `${mins}m ${segs}s`;
        }
        return `${segundos.toFixed(1)}s`;
    };

    if (resultado) {
        const duracaoFormatada = formatarTempo(resultado.duracao_video || 0);
        const tempoProcessamentoFormatado = `${(resultado.tempo_processamento || 0).toFixed(1)}s`;
        const multiplicador = resultado.tempo_processamento > 0 
            ? ((resultado.duracao_video || 0) / resultado.tempo_processamento).toFixed(1) 
            : '0.0';

        const tempoUpload = Math.max(0, tempoTotalEspera - (resultado.tempo_processamento || 0));
        const tempoUploadFormatado = `${tempoUpload.toFixed(1)}s`;
        const tempoEsperaTotalFormatada = formatarTempo(tempoTotalEspera || 0);

        return (
            <div className="vp-card" style={{ textAlign: 'center', borderColor: 'var(--vp-orange)' }}>
                <span className="vp-micro-label" style={{ color: 'var(--vp-orange)' }}>Módulo Drone (IA Server)</span>
                <h3 className="vp-title text-success mb-2">
                    <i className="bi bi-check-circle-fill me-2"></i>Análise Concluída!
                </h3>
                <p className="vp-subtitle mb-4">Veja as estatísticas de processamento do vídeo abaixo.</p>

                <div className="row g-2 mb-4 text-start">
                    <div className="col-6">
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid #6c757d !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Duração do Vídeo</span>
                            <span className="fs-5 fw-bold text-dark">{duracaoFormatada}</span>
                        </div>
                    </div>
                    <div className="col-6">
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid #0056b3 !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Bobinas Detectadas</span>
                            <span className="fs-5 fw-bold text-primary">{resultado.total_encontrados} un.</span>
                        </div>
                    </div>
                    <div className="col-6">
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid var(--vp-orange) !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Processamento IA</span>
                            <span className="fs-5 fw-bold text-dark">{tempoProcessamentoFormatado}</span>
                        </div>
                    </div>
                    <div className="col-6">
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid #28a745 !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Performance IA</span>
                            <span className="fs-5 fw-bold text-success" style={{ color: '#28a745' }}>
                                {multiplicador}x <span className="small fs-6 text-secondary fw-normal">veloz</span>
                            </span>
                        </div>
                    </div>
                    <div className="col-6">
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid #8e44ad !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Envio / Transmissão</span>
                            <span className="fs-5 fw-bold text-purple" style={{ color: '#8e44ad' }}>{tempoUploadFormatado}</span>
                        </div>
                    </div>
                    <div className="col-6">
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid #e74c3c !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Tempo Total Real</span>
                            <span className="fs-5 fw-bold text-danger" style={{ color: '#e74c3c' }}>{tempoEsperaTotalFormatada}</span>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '400px', margin: '0 auto' }}>
                    <button 
                        className="vp-btn vp-btn-primary" 
                        style={{ flex: 1, backgroundColor: 'var(--vp-orange)', border: 'none' }} 
                        onClick={() => aoConcluir(resultado.codigos)}
                    >
                        Confirmar e Importar
                    </button>
                    <button 
                        className="vp-btn vp-btn-outline" 
                        style={{ flex: 1 }} 
                        onClick={() => {
                            setResultado(null);
                            setArquivo(null);
                        }}
                    >
                        Novo Vídeo
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="vp-card" style={{ textAlign: 'center', borderColor: 'var(--vp-orange)' }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
                <span className="vp-micro-label m-0" style={{ color: 'var(--vp-orange)' }}>Módulo Drone (IA Server)</span>
                <div className="d-flex align-items-center">
                    {statusBackend === 'online' && (
                        <span className="badge bg-success-subtle text-success border border-success rounded-pill px-3 py-1 fw-bold d-inline-flex align-items-center" style={{ fontSize: '0.78rem' }}>
                            <span className="spinner-grow spinner-grow-sm me-1" role="status" aria-hidden="true" style={{ width: '8px', height: '8px' }}></span>
                            ● ONLINE
                        </span>
                    )}
                    {statusBackend === 'offline' && (
                        <span className="badge bg-danger-subtle text-danger border border-danger rounded-pill px-3 py-1 fw-bold d-inline-flex align-items-center" style={{ fontSize: '0.78rem' }}>
                            ● OFFLINE
                        </span>
                    )}
                    {statusBackend === 'checando' && (
                        <span className="badge bg-warning-subtle text-warning border border-warning rounded-pill px-3 py-1 fw-bold d-inline-flex align-items-center" style={{ fontSize: '0.78rem' }}>
                            <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" style={{ width: '10px', height: '10px' }}></span>
                            Checando...
                        </span>
                    )}
                    <button 
                        type="button" 
                        className="btn btn-sm text-secondary p-0 ms-2" 
                        onClick={() => testarConexaoBackend(urlApi)}
                        title="Re-testar conexão com o servidor"
                        style={{ fontSize: '0.9rem', lineHeight: 1 }}
                    >
                        <i className="bi bi-arrow-clockwise"></i>
                    </button>
                </div>
            </div>
            <h3 className="vp-title mb-2">Análise de Vídeo em Nuvem</h3>
            
            {/* Seletor de Modo de Envio */}
            <div className="d-flex justify-content-center gap-2 mb-3">
                <button 
                    type="button" 
                    className={`btn btn-sm ${modoEnvio === 'upload' ? 'btn-primary' : 'btn-outline-secondary'}`} 
                    style={modoEnvio === 'upload' ? { backgroundColor: 'var(--vp-orange)', borderColor: 'var(--vp-orange)', fontWeight: 'bold' } : {}}
                    onClick={() => setModoEnvio('upload')}
                >
                    📁 Upload Navegador
                </button>
                <button 
                    type="button" 
                    className={`btn btn-sm ${modoEnvio === 'local_folder' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    style={modoEnvio === 'local_folder' ? { backgroundColor: 'var(--vp-orange)', borderColor: 'var(--vp-orange)', fontWeight: 'bold' } : {}}
                    onClick={() => setModoEnvio('local_folder')}
                >
                    ⚡ Pasta Local do Servidor (0s Upload)
                </button>
            </div>

            {modoEnvio === 'upload' ? (
                <>
                    <p className="vp-subtitle mb-3">Envie a gravação (.MP4 ou .MOV) para decodificação profunda no servidor.</p>

                    {!arquivo ? (
                        <div style={{ padding: '1rem 0' }}>
                            <div className="mb-4">
                                <input type="file" accept="video/*" id="videoDrone" onChange={lidarComUploadVideo} style={{ display: 'none' }} />
                                <label htmlFor="videoDrone" className="vp-btn vp-btn-outline w-100" style={{ borderColor: 'var(--vp-orange)', color: 'var(--vp-orange)', maxWidth: '320px', margin: '0 auto', display: 'block' }}>
                                    📁 Selecionar Vídeo do Drone
                                </label>
                            </div>

                            <div className="p-3 border rounded text-start bg-light shadow-sm" style={{ maxWidth: '400px', margin: '0 auto 1.5rem auto', borderLeft: '4px solid var(--vp-orange)' }}>
                                <h6 className="fw-bold text-dark mb-1" style={{ fontSize: '0.85rem' }}>
                                    💡 Dica de Performance para Celular:
                                </h6>
                                <p className="text-secondary m-0" style={{ fontSize: '0.78rem', lineHeight: '1.4' }}>
                                    Vídeos gravados diretamente do celular em Full HD/4K costumam ser muito pesados (ex: 200MB+). 
                                    Configure a câmera para **480p ou 720p (menor resolução)** antes de gravar os corredores. 
                                    Isso reduz o tempo de upload em até 90% e evita bloqueios de tamanho no túnel do galpão (limite máximo de 100MB).
                                </p>
                            </div>

                            <button className="vp-btn vp-btn-outline" style={{ display: 'inline-block' }} onClick={aoCancelar}>
                                Voltar
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ padding: '1rem', background: 'var(--vp-surface-alt)', borderRadius: '8px', width: '100%', maxWidth: '400px' }}>
                                <p className="vp-mono" style={{ margin: 0, fontWeight: 'bold' }}>Arquivo: {arquivo.name}</p>
                                <p className="vp-subtitle" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                                    Tamanho: {(arquivo.size / (1024 * 1024)).toFixed(2)} MB
                                </p>
                            </div>

                            {processando && (
                                <div style={{ color: 'var(--vp-orange)', fontWeight: 'bold', margin: '1rem 0', fontSize: '0.9rem' }}>
                                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                    {status}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '400px' }}>
                                {!processando && (
                                    <>
                                        <button className="vp-btn vp-btn-primary" style={{ flex: 1, backgroundColor: 'var(--vp-orange)' }} onClick={enviarParaServidor}>
                                            Enviar para Análise
                                        </button>
                                        <button className="vp-btn vp-btn-outline" style={{ flex: 1 }} onClick={() => setArquivo(null)}>
                                            Trocar Vídeo
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div style={{ maxWidth: '440px', margin: '0 auto', textAlign: 'left' }}>
                    <div className="p-3 border rounded bg-light mb-3" style={{ borderLeft: '4px solid var(--vp-orange)' }}>
                        <h6 className="fw-bold text-dark mb-1" style={{ fontSize: '0.85rem' }}>
                            🚀 Leitura Direta do Disco (Sem Upload)
                        </h6>
                        <p className="text-secondary mb-2" style={{ fontSize: '0.78rem', lineHeight: '1.4' }}>
                            Os arquivos de vídeo ficam salvos na pasta local do computador:
                        </p>
                        <code className="d-block p-2 bg-white border rounded font-monospace text-dark text-break mb-2" style={{ fontSize: '0.75rem' }}>
                            {caminhoPastaLocal || 'C:\\Users\\wanderson.oliveira\\Desktop\\inventario\\backend\\videos_drone'}
                        </code>
                        <div className="p-2 rounded bg-warning-subtle border border-warning text-dark" style={{ fontSize: '0.76rem', lineHeight: '1.35' }}>
                            <strong>💡 Dica de Ouro DJI (Processamento 14x Mais Rápido!):</strong><br />
                            Seu drone DJI Mini 4 Pro grava automaticamente um arquivo <strong>.LRF</strong> de baixa resolução (720p HD) ao lado do vídeo <strong>.MP4</strong>.<br />
                            • O arquivo <strong>.MP4</strong> (1.4GB a 3.6GB em 4K) consome muita CPU e demora minutos.<br />
                            • O arquivo <strong>.LRF</strong> (400MB a 700MB) processa em <strong>apenas 30 segundos</strong> com a mesma precisão!
                        </div>
                    </div>

                    <div className="d-flex justify-content-between align-items-center mb-2">
                        <label className="form-label small fw-bold mb-0">Vídeos Encontrados na Pasta Local:</label>
                        <button 
                            type="button" 
                            className="btn btn-sm btn-outline-secondary py-0 px-2"
                            onClick={carregarVideosLocais}
                            disabled={carregandoVideosLocais}
                            style={{ fontSize: '0.78rem' }}
                        >
                            {carregandoVideosLocais ? 'Carregando...' : '🔄 Atualizar Lista'}
                        </button>
                    </div>

                    {videosLocais.length === 0 ? (
                        <div className="p-3 border rounded bg-white text-center mb-3">
                            <p className="text-muted m-0 small">
                                {carregandoVideosLocais ? 'Buscando arquivos na pasta...' : 'Nenhum vídeo encontrado na pasta backend/videos_drone. Cole um vídeo (.mp4/.lrf) nela e clique em Atualizar.'}
                            </p>
                        </div>
                    ) : (
                        <div className="mb-3">
                            <select 
                                className="form-select form-select-sm mb-3"
                                value={videoLocalSelecionado}
                                onChange={(e) => setVideoLocalSelecionado(e.target.value)}
                                disabled={processando}
                            >
                                {videosLocais.map((v) => {
                                    const ehLrf = v.nome.toLowerCase().endsWith('.lrf');
                                    return (
                                        <option key={v.nome} value={v.nome}>
                                            {ehLrf ? '⚡ [RECOMENDADO] ' : '🎬 '} {v.nome} ({v.tamanho_mb} MB - {v.data_modificacao})
                                        </option>
                                    );
                                })}
                            </select>

                            {processando && (
                                <div style={{ color: 'var(--vp-orange)', fontWeight: 'bold', margin: '1rem 0', fontSize: '0.9rem' }} className="text-center">
                                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                    {status}
                                </div>
                            )}

                            {!processando && (
                                <button 
                                    className="vp-btn vp-btn-primary w-100" 
                                    style={{ backgroundColor: 'var(--vp-orange)' }}
                                    onClick={processarVideoLocal}
                                    disabled={!videoLocalSelecionado}
                                >
                                    ⚡ Processar Vídeo Local Instantaneamente
                                </button>
                            )}
                        </div>
                    )}

                    <div className="text-center mt-3">
                        <button className="vp-btn vp-btn-outline" style={{ display: 'inline-block' }} onClick={aoCancelar}>
                            Voltar
                        </button>
                    </div>
                </div>
            )}

            {/* Painel de Configuração do Túnel / Servidor Backend */}
            <div className="mt-4 pt-3 border-top text-center" style={{ maxWidth: '440px', margin: '0 auto' }}>
                <button 
                    type="button"
                    className="btn btn-sm btn-link text-decoration-none text-secondary"
                    onClick={() => setMostrarConfigUrl(!mostrarConfigUrl)}
                    style={{ fontSize: '0.8rem' }}
                >
                    ⚙️ {mostrarConfigUrl ? 'Ocultar Configuração do Backend' : 'Configurar URL do Servidor (Túnel)'}
                </button>

                {mostrarConfigUrl && (
                    <div className="p-3 border rounded bg-white shadow-sm mt-2 text-start" style={{ borderColor: 'var(--vp-orange)' }}>
                        <label className="form-label small fw-bold text-dark mb-1">
                            🌐 URL do Backend (Cloudflare / Local):
                        </label>
                        <div className="input-group input-group-sm mb-2">
                            <input 
                                type="text"
                                className="form-control font-monospace"
                                value={urlApi}
                                onChange={(e) => salvarUrlCustomizada(e.target.value)}
                                placeholder="https://...trycloudflare.com"
                                style={{ fontSize: '0.78rem' }}
                            />
                            <button 
                                className="btn btn-outline-secondary"
                                type="button"
                                onClick={() => salvarUrlCustomizada(apiPadrao)}
                                title="Restaurar Padrão"
                            >
                                Reset
                            </button>
                        </div>
                        <p className="text-muted m-0" style={{ fontSize: '0.72rem' }}>
                            Se o backend foi reiniciado e a URL do túnel mudou, cole a nova URL acima. Ela será salva no seu navegador.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProcessadorDroneTurbo;
