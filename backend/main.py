from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import shutil
import os
import re
import numpy as np
from pyzbar.pyzbar import decode, ZBarSymbol

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Regras de captura (Lote Videplast e Romaneio Logístico)
PADRAO_VL2LT = re.compile(r'VL2LT(.*?)KG')
PADRAO_ROMANEIO = re.compile(r'\(7\)(.*?)\(8\)')

def extrair_conteudo_qr(texto_bruto):
    """Aplica a regra de negócio para extrair o código limpo."""
    try:
        texto_limpo = texto_bruto.decode('utf-8').upper().strip()
    except:
        texto_limpo = str(texto_bruto).upper().strip()
        
    # 1. Tenta achar o Lote Padrão
    match_lote = PADRAO_VL2LT.search(texto_limpo)
    if match_lote:
        return match_lote.group(1).strip()
        
    # 2. Tenta achar o Romaneio
    match_romaneio = PADRAO_ROMANEIO.search(texto_limpo)
    if match_romaneio:
        return match_romaneio.group(1).strip()
        
    # 3. Retorna direto (Ex: Leitura do código de barras 1D do romaneio)
    return texto_limpo

def gerar_variacoes_imagem(frame_cinza):
    """
    Estratégia Multi-Pass: Gera 4 versões da mesma imagem para garantir 
    que o leitor encontre o código, não importa a iluminação ou desfoque.
    """
    variacoes = [frame_cinza] # Pass 1: Original
    
    # Pass 2: Threshold Adaptativo (A MAGIA contra sombras e etiquetas dobradas)
    # Analisa blocos de 31x31 pixels para ignorar o fundo escuro/claro
    adaptativo = cv2.adaptiveThreshold(
        frame_cinza, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
    )
    variacoes.append(adaptativo)
    
    # Pass 3: CLAHE (Equalização de Histograma)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    contraste = clahe.apply(frame_cinza)
    variacoes.append(contraste)
    
    # Pass 4: Binarização Otsu sobre o CLAHE
    _, otsu = cv2.threshold(contraste, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variacoes.append(otsu)
    
    return variacoes

@app.post("/api/processar-drone")
async def processar_video_drone(file: UploadFile = File(...)):
    pasta_temp = "temp_processamento"
    if not os.path.exists(pasta_temp):
        os.makedirs(pasta_temp)
        
    temp_filename = os.path.join(pasta_temp, f"temp_{file.filename}")
    with open(temp_filename, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    cap = cv2.VideoCapture(temp_filename)
    codigos_encontrados = set()
    
    fps_video = cap.get(cv2.CAP_PROP_FPS) or 30
    frames_para_pular = int(fps_video) 
    LARGURA_ALVO = 1280 

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        
        frame_count = cap.get(cv2.CAP_PROP_POS_FRAMES)
        if frame_count % frames_para_pular != 0:
            continue

        altura, largura = frame.shape[:2]
        if largura > LARGURA_ALVO:
            proporcao = LARGURA_ALVO / float(largura)
            dimensoes = (LARGURA_ALVO, int(altura * proporcao))
            frame_processado = cv2.resize(frame, dimensoes, interpolation=cv2.INTER_AREA)
        else:
            frame_processado = frame

        cinza = cv2.cvtColor(frame_processado, cv2.COLOR_BGR2GRAY)
        
        # Gera as versões contra sombras, dobras e desfoque
        variacoes = gerar_variacoes_imagem(cinza)

        achou_no_frame = False
        for img in variacoes:
            # OTIMIZAÇÃO DE LEITURA: Procura QR Codes E Códigos de Barras (CODE128/CODE39)
            leituras = decode(img, symbols=[ZBarSymbol.QRCODE, ZBarSymbol.CODE128, ZBarSymbol.CODE39])
            
            if leituras:
                for leitura in leituras:
                    if leitura.data:
                        codigo_final = extrair_conteudo_qr(leitura.data)
                        codigos_encontrados.add(codigo_final)
                        achou_no_frame = True
            
            # Se já achou nesta variação, não perde tempo a processar os outros filtros para este frame
            if achou_no_frame:
                break

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
    uvicorn.run(app, host="0.0.0.0", port=8000)