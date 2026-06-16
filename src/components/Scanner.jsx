import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const Scanner = ({ aoLerCodigo, aoCancelar }) => {
  const scannerRef = useRef(null);

  useEffect(() => {
    scannerRef.current = new Html5Qrcode("leitor-camera");

    const iniciarCamera = async () => {
      const configuracaoCamera = {
        fps: 15,
        videoConstraints: {
          width: { min: 1280, ideal: 1920 },
          height: { min: 720, ideal: 1080 },
          focusMode: "continuous"
        },
        qrbox: (videoWidth, videoHeight) => {
          const minDimension = Math.min(videoWidth, videoHeight);
          return {
            width: Math.floor(minDimension * 0.7),
            height: Math.floor(minDimension * 0.7)
          };
        }
      };

      try {
        await scannerRef.current.start(
          { facingMode: { exact: "environment" } },
          configuracaoCamera,
          (textoDecodificado) => {
            if (scannerRef.current && scannerRef.current.getState() === 2 /* SCANNING */) {
              scannerRef.current.pause();
              scannerRef.current.stop().then(() => {
                aoLerCodigo(textoDecodificado);
              }).catch(console.error);
            }
          },
          (erro) => {
          }
        );
      } catch (err) {
        console.warn("A câmara traseira 'exata' falhou. A tentar de forma normal...", err);

        try {
          await scannerRef.current.start(
            { facingMode: "environment" },
            configuracaoCamera,
            (textoDecodificado) => {
              if (scannerRef.current && scannerRef.current.getState() === 2 /* SCANNING */) {
                scannerRef.current.pause();
                scannerRef.current.stop().then(() => {
                  aoLerCodigo(textoDecodificado);
                }).catch(console.error);
              }
            },
            (erro) => { }
          );
        } catch (errFallback) {
          console.error("Erro total ao acessar a câmara: ", errFallback);
        }
      }
    };

    iniciarCamera();

    return () => {
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