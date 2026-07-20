import React, { useState } from 'react';

const ProcessadorDroneTurbo = ({ aoConcluir, aoCancelar }) => {
    const [arquivo, setArquivo] = useState(null);
    const [processando, setProcessando] = useState(false);
    const [status, setStatus] = useState('');
    const [resultado, setResultado] = useState(null);

    const lidarComUploadVideo = (e) => {
        const file = e.target.files[0];
        if (file) {
            setArquivo(file);
            setResultado(null);
        }
    };

    const enviarParaServidor = async () => {
        if (!arquivo) return;
        setProcessando(true);
        setStatus('Fazendo upload do vídeo para o servidor...');

        const formData = new FormData();
        formData.append("file", arquivo);

        try {
            // Usa a variável de ambiente se estiver definida (ex: Render), senão aponta fixo para esta máquina local (10.172.0.130)
            const API_URL = import.meta.env.VITE_API_URL || "http://10.172.0.130:8000";
            const API_KEY = import.meta.env.VITE_API_KEY || "videplast_segredo_padrao_2026";

            setStatus('Analisando imagens (Visão Computacional)...');
            const resposta = await fetch(`${API_URL}/api/processar-drone`, {
                method: "POST",
                headers: {
                    "X-API-KEY": API_KEY
                },
                body: formData,
            });

            if (!resposta.ok) {
                throw new Error("Falha na comunicação com o servidor de IA.");
            }

            const dados = await resposta.json();
            
            // Salva o resultado no estado para exibir as estatísticas
            setResultado(dados);
            setStatus(`Sucesso! ${dados.total_encontrados} códigos lidos.`);

        } catch (erro) {
            console.error(erro);
            alert("Erro ao processar vídeo: " + erro.message);
            setStatus('Erro no processamento.');
        } finally {
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
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid var(--vp-orange) !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Tempo de Análise</span>
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
                        <div className="p-3 border rounded bg-white shadow-sm" style={{ borderLeft: '4px solid #0056b3 !important' }}>
                            <span className="small text-secondary fw-bold d-block mb-1">Bobinas Detectadas</span>
                            <span className="fs-5 fw-bold text-primary">{resultado.total_encontrados} un.</span>
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
            <span className="vp-micro-label" style={{ color: 'var(--vp-orange)' }}>Módulo Drone (IA Server)</span>
            <h3 className="vp-title">Análise de Vídeo em Nuvem</h3>
            <p className="vp-subtitle mb-3">Envie a gravação (.MP4 ou .MOV) para decodificação profunda no servidor.</p>

            {!arquivo ? (
                <div style={{ padding: '2rem 0' }}>
                    <input type="file" accept="video/*" id="videoDrone" onChange={lidarComUploadVideo} style={{ display: 'none' }} />
                    <label htmlFor="videoDrone" className="vp-btn vp-btn-outline" style={{ borderColor: 'var(--vp-orange)', color: 'var(--vp-orange)' }}>
                        📁 Selecionar Vídeo do Drone
                    </label>
                    <button className="vp-btn vp-btn-outline" style={{ marginTop: '1rem', marginLeft: '1rem' }} onClick={aoCancelar}>
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
                        <div style={{ color: 'var(--vp-orange)', fontWeight: 'bold', margin: '1rem 0' }}>
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
        </div>
    );
};

export default ProcessadorDroneTurbo;