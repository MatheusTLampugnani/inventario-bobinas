import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const Scanner = ({ aoLerCodigo, aoCancelar }) => {
  const scannerRef = useRef(null);
  const [escaneando, setEscaneando] = useState(true);
  const [erroPermissao, setErroPermissao] = useState('');

  const lidarComCancelar = () => {
    setEscaneando(false);
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop()
            .then(() => {
              scannerRef.current.clear();
              aoCancelar();
            })
            .catch(err => {
              console.warn("Aviso ao desligar câmera:", err);
              aoCancelar();
            });
        } else {
          scannerRef.current.clear();
          aoCancelar();
        }
      } catch (e) {
        console.warn("Erro no cancelamento da câmera:", e);
        aoCancelar();
      }
    } else {
      aoCancelar();
    }
  };

  useEffect(() => {
    scannerRef.current = new Html5Qrcode("leitor-camera");
    let montado = true;

    setTimeout(async () => {
      if (!montado) return;
      try {
        await scannerRef.current.start(
          { facingMode: "environment" },
          {
            fps: 15,
            qrbox: (videoWidth, videoHeight) => {
              const minDimension = Math.min(videoWidth, videoHeight);
              return {
                width: Math.floor(minDimension * 0.7),
                height: Math.floor(minDimension * 0.7)
              };
            }
          },
          (textoDecodificado) => {
            if (scannerRef.current && scannerRef.current.getState() === 2) {
              scannerRef.current.pause();
              scannerRef.current.stop().then(() => {
                if (montado) setEscaneando(false);
                aoLerCodigo(textoDecodificado);
              }).catch(console.error);
            }
          },
          (erro) => { }
        );
      } catch (err) {
        console.error("Erro ao ligar a câmera:", err);
        if (montado) {
          setErroPermissao("Permita o acesso à câmera no seu navegador para continuar.");
          setEscaneando(false);
        }
      }
    }, 150);

    return () => {
      montado = false;
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop()
              .then(() => scannerRef.current.clear())
              .catch(err => console.warn("Aviso ao desligar câmera:", err));
          } else {
            scannerRef.current.clear();
          }
        } catch (e) {
          console.warn("Aviso no cleanup da câmera:", e);
        }
      }
    };
  }, [aoLerCodigo]);

  return (
    <div className="vp-card no-hover mb-4 animate__animated animate__fadeIn" style={{ margin: 0 }}>
      <div className="text-center">

        {/* MENSAGEM DE ERRO */}
        {erroPermissao && (
          <div className="alert alert-danger small p-2 mb-3">
            {erroPermissao}
          </div>
        )}

        {/* MENSAGEM DE CARREGAMENTO */}
        {escaneando && !erroPermissao && (
          <span className="vp-micro-label mb-3 d-block text-secondary">
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" style={{ width: '12px', height: '12px' }}></span>
            A iniciar câmera...
          </span>
        )}

        {/* CAIXA DE VÍDEO */}
        <div
          id="leitor-camera"
          className={escaneando ? "bg-dark mb-3" : ""}
          style={{
            width: '100%',
            maxWidth: '400px',
            margin: '0 auto',
            overflow: 'hidden',
            borderRadius: '8px'
          }}
        ></div>

        {/* BOTÃO DE CANCELAR */}
        <div className="mt-3 d-flex justify-content-center">
          <button
            className="vp-btn vp-btn-outline w-100 d-flex justify-content-center align-items-center"
            style={{ borderColor: 'var(--vp-red)', color: 'var(--vp-red)' }}
            onClick={lidarComCancelar}
          >
            Cancelar Leitura
          </button>
        </div>

      </div>
    </div>
  );
};

export default Scanner;