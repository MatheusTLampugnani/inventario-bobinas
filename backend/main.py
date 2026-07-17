# Instalação das dependências:
# pip install opencv-python fastapi uvicorn zxing-cpp numpy python-multipart

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import shutil
import os
import numpy as np
import zxingcpp

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DIR_ATUAL = os.path.dirname(os.path.abspath(__file__))

def gerar_variacoes_imagem(frame_cinza):
    """Gera variações de imagem (filtros) para maximizar a decodificação em condições adversas."""
    variacoes = [frame_cinza]
    
    # Variação 2: Threshold Adaptativo (ótimo para sombras e curvas)
    try:
        adaptativo = cv2.adaptiveThreshold(
            frame_cinza, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
        )
        variacoes.append(adaptativo)
    except Exception as e:
        print(f"[Filtros] Erro ao gerar threshold adaptativo: {e}")
        
    # Variação 3: CLAHE (Equalização adaptativa para contraste e brilho)
    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        contraste = clahe.apply(frame_cinza)
        variacoes.append(contraste)
        
        # Variação 4: Otsu sobre o CLAHE (binarização limpa)
        try:
            _, otsu = cv2.threshold(contraste, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            variacoes.append(otsu)
        except Exception as e:
            print(f"[Filtros] Erro ao gerar Otsu: {e}")
    except Exception as e:
        print(f"[Filtros] Erro ao gerar CLAHE: {e}")
        
    return variacoes

def decodificar_frame(frame):
    """Aplica os filtros de imagem e lê todos os códigos presentes no frame via ZXing."""
    codigos_do_frame = []
    try:
        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Gera variações do frame
        variacoes = gerar_variacoes_imagem(frame_gray)
        
        # Tenta decodificar cada variação usando zxingcpp
        for img in variacoes:
            try:
                resultados = zxingcpp.read_barcodes(img)
                for r in resultados:
                    if r.valid and r.text:
                        texto_limpo = r.text.strip()
                        if texto_limpo and texto_limpo not in codigos_do_frame:
                            codigos_do_frame.append(texto_limpo)
            except Exception:
                pass
    except Exception as e:
        print(f"[ZXing Error] Erro ao processar frame: {e}")
        
    return codigos_do_frame

@app.post("/api/processar-drone")
async def processar_video_drone(file: UploadFile = File(...)):
    pasta_temp = os.path.join(DIR_ATUAL, "temp_processamento")
    if not os.path.exists(pasta_temp):
        os.makedirs(pasta_temp)
        
    temp_filename = os.path.join(pasta_temp, f"temp_{file.filename}")
    with open(temp_filename, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    cap = cv2.VideoCapture(temp_filename)
    codigos_encontrados = set()
    
    fps_video = cap.get(cv2.CAP_PROP_FPS) or 30
    # Processa cerca de 5 frames por segundo de vídeo (equilíbrio ideal entre velocidade e cobertura)
    frames_para_pular = max(1, int(fps_video / 5))
    
    frame_anterior_cinza = None
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        
        frame_count = cap.get(cv2.CAP_PROP_POS_FRAMES)
        if frame_count % frames_para_pular != 0:
            continue
        
        # Filtro de movimento de frames simples
        frame_pequeno = cv2.resize(frame, (256, 256))
        frame_cinza = cv2.cvtColor(frame_pequeno, cv2.COLOR_BGR2GRAY)
        
        if frame_anterior_cinza is not None:
            diff = cv2.absdiff(frame_cinza, frame_anterior_cinza)
            mean_diff = np.mean(diff) / 255.0
            
            # Pula frames com movimento irrelevante (menos de 0.5% de variação de pixels)
            if mean_diff < 0.005:
                continue
                
        frame_anterior_cinza = frame_cinza
        
        # Decodifica o frame aplicando os filtros
        novos_codigos = decodificar_frame(frame)
        for cod in novos_codigos:
            codigos_encontrados.add(cod)

    cap.release()
    try:
        if os.path.exists(temp_filename):
            os.remove(temp_filename)
    except Exception:
        pass

    return {
        "sucesso": True,
        "total_encontrados": len(codigos_encontrados),
        "codigos": list(codigos_encontrados)
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)