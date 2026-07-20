import React, { useState } from 'react';

const ProcessadorDroneTurbo = ({ aoConcluir, aoCancelar }) => {
    const [arquivo, setArquivo] = useState(null);
    const [processando, setProcessando] = useState(false);
    const [status, setStatus] = useState('');

    const lidarComUploadVideo = (e) => {
        const file = e.target.files[0];
        if (file) {
            setArquivo(file);
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

            setStatus(`Sucesso! ${dados.total_encontrados} códigos lidos.`);

            // Pausa um segundo para o usuário ler o sucesso, e manda para o App.jsx
            setTimeout(() => {
                aoConcluir(dados.codigos);
            }, 1500);

        } catch (erro) {
            console.error(erro);
            alert("Erro ao processar vídeo: " + erro.message);
            setStatus('Erro no processamento.');
        } finally {
            if (status !== 'Sucesso!') setProcessando(false);
        }
    };

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