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
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (textoDecodificado) => {
            if (scannerRef.current && scannerRef.current.isScanning) {
              scannerRef.current.stop().then(() => {
                aoLerCodigo(textoDecodificado);
              }).catch(console.error);
            }
          },
          (erro) => {
          }
        );
      } catch (err) {
        console.error("Erro ao aceder à câmara: ", err);
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