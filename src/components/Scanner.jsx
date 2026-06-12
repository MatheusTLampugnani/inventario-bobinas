import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const Scanner = ({ aoLerCodigo, aoCancelar }) => {
  const scannerRef = useRef(null);

  useEffect(() => {
    scannerRef.current = new Html5Qrcode("leitor-camera");

    const iniciarCamera = async () => {
      try {
        await scannerRef.current.start(
          { facingMode: "environment" },
          {
            fps: 30, // Aumentado para 30 frames por segundo (mais agilidade)

            // Força alta resolução (HD/Full HD) e foco contínuo para ler códigos densos e distantes
            videoConstraints: {
              width: { min: 1280, ideal: 1920 },
              height: { min: 720, ideal: 1080 },
              focusMode: "continuous"
            },

            // Caixa de leitura dinâmica: ocupa 70% da tela independentemente do celular
            qrbox: (videoWidth, videoHeight) => {
              const minDimension = Math.min(videoWidth, videoHeight);
              return {
                width: Math.floor(minDimension * 0.7),
                height: Math.floor(minDimension * 0.7)
              };
            }
          },
          (textoDecodificado) => {
            if (scannerRef.current && scannerRef.current.getState() === 2 /* SCANNING */) {
              // Pausa o leitor imediatamente para não bipar duas vezes o mesmo código
              scannerRef.current.pause();

              // Executa o fechamento do scanner com segurança
              scannerRef.current.stop().then(() => {
                aoLerCodigo(textoDecodificado);
              }).catch(console.error);
            }
          },
          (erro) => {
            // Ignorar falhas de frame vazio silenciosamente para não poluir o console
          }
        );
      } catch (err) {
        console.error("Erro ao acessar à câmara: ", err);
      }
    };

    iniciarCamera();

    return () => {
      // Limpeza segura ao desmontar o componente
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [aoLerCodigo]);

  return (
    <div className="card shadow-sm border-0 mb-4 animate__animated animate__fadeIn">
      <div className="card-body p-3 text-center">
        <h6 className="text-muted mb-3">Aponte a câmara para a bobina</h6>

        <div
          id="leitor-camera"
          style={{ width: '100%', maxWidth: '400px', margin: '0 auto', overflow: 'hidden', borderRadius: '8px' }}
        ></div>

        <button className="btn btn-outline-danger mt-3 px-4" onClick={aoCancelar}>
          Cancelar Câmara
        </button>
      </div>
    </div>
  );
};

export default Scanner;