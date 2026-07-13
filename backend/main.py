# Instalação das dependências:
# pip install opencv-python fastapi uvicorn onnxruntime zxing-cpp numpy requests python-multipart

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import shutil
import os
import re
import numpy as np
import requests
import onnxruntime as ort
import zxingcpp
from concurrent.futures import ThreadPoolExecutor

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configurações de caminhos e modelos
DIR_ATUAL = os.path.dirname(os.path.abspath(__file__))
MODELO_ESPECIALIZADO = os.path.join(DIR_ATUAL, "yolov8n-obc.onnx")
MODELO_FALLBACK = os.path.join(DIR_ATUAL, "yolov8n.onnx")
URL_DOWNLOAD_FALLBACK = "https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx"

def garantir_modelo():
    """Garante que o modelo YOLOv8-ONNX exista localmente no disco."""
    if os.path.exists(MODELO_ESPECIALIZADO):
        print(f"[IA] Usando modelo especializado em códigos de barra: {MODELO_ESPECIALIZADO}")
        return MODELO_ESPECIALIZADO
        
    if os.path.exists(MODELO_FALLBACK):
        print(f"[IA] Usando modelo YOLOv8 padrão como fallback: {MODELO_FALLBACK}")
        return MODELO_FALLBACK
        
    print(f"[IA] Modelo não encontrado localmente. Baixando o fallback {MODELO_FALLBACK} de {URL_DOWNLOAD_FALLBACK}...")
    try:
        response = requests.get(URL_DOWNLOAD_FALLBACK, stream=True)
        response.raise_for_status()
        with open(MODELO_FALLBACK, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"[IA] Download concluído com sucesso: {MODELO_FALLBACK}")
        return MODELO_FALLBACK
    except Exception as e:
        print(f"[ERROR] Falha ao baixar o modelo YOLOv8: {e}")
        # Mesmo com erro, retorna o caminho do fallback para tentar carregar caso exista ou levantar erro apropriado
        return MODELO_FALLBACK

# Inicializa o modelo YOLOv8 ONNX
caminho_modelo = garantir_modelo()
print(f"[IA] Inicializando sessão ONNX Runtime com o modelo: {caminho_modelo}")
session = ort.InferenceSession(caminho_modelo, providers=['CPUExecutionProvider'])
input_name = session.get_inputs()[0].name

# Regras de captura de lote da Videplast e Romaneio Logístico
PADRAO_VL2LT = re.compile(r'VL2LT(.*?)KG')
PADRAO_ROMANEIO = re.compile(r'\(7\)(.*?)\(8\)')

# Novos formatos de Lote e Romaneio identificados (Exatamente 10 caracteres)
PADRAO_LOTE_RA = re.compile(r'^(RA|VA|MA|UV)\d{8}$', re.IGNORECASE)     # Lote: RA/VA/MA/UV seguido de exatamente 8 dígitos (total 10 chars)
PADRAO_ROMANEIO_NUM = re.compile(r'^500\d{7}$')             # Romaneio: 500 seguido de exatamente 7 dígitos (ex: 5001810083)

def extrair_conteudo_qr(texto_bruto):
    """Aplica a regra de negócio para extrair o código limpo (Lote ou Romaneio) e descarta ruídos."""
    try:
        if isinstance(texto_bruto, bytes):
            texto_limpo = texto_bruto.decode('utf-8').upper().strip()
        else:
            texto_limpo = str(texto_bruto).upper().strip()
    except Exception:
        texto_limpo = str(texto_bruto).upper().strip()
        
    # 1. Tenta encontrar o Lote Padrão original (VL2LT...KG)
    match_lote = PADRAO_VL2LT.search(texto_limpo)
    if match_lote:
        return match_lote.group(1).strip()
        
    # 2. Tenta encontrar o Romaneio GS1 original ((7)...(8))
    match_romaneio = PADRAO_ROMANEIO.search(texto_limpo)
    if match_romaneio:
        return match_romaneio.group(1).strip()
        
    # 3. Tenta encontrar o novo formato de Lote (RA + dígitos, ex: RA03199248)
    if PADRAO_LOTE_RA.match(texto_limpo):
        return texto_limpo
        
    # 4. Tenta encontrar o novo formato de Romaneio (número iniciado com 5, ex: 5001810083)
    if PADRAO_ROMANEIO_NUM.match(texto_limpo):
        return texto_limpo
        
    # Se não corresponder a nenhuma das regras de negócio válidas, descartamos retornando None
    return None

def processar_recorte(crop):
    """Executa a decodificação ZXing em um recorte focal (crop) em tons de cinza."""
    try:
        if crop is None or crop.size == 0:
            return []
        
        # Converte para tons de cinza para melhor decodificação
        crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        
        # ZXing-C++ é muito mais robusto e rápido
        resultados = zxingcpp.read_barcodes(crop_gray)
        codigos_recorte = []
        for r in resultados:
            if r.valid and r.text:
                codigo_limpo = extrair_conteudo_qr(r.text)
                if codigo_limpo:
                    codigos_recorte.append(codigo_limpo)
        return codigos_recorte
    except Exception as e:
        print(f"[ZXing Error] Falha ao decodificar recorte: {e}")
        return []

def detectar_e_decodificar(frame, executor):
    """Detecta as coordenadas dos códigos de barras com YOLOv8 e decodifica os recortes via ZXing."""
    altura_orig, largura_orig = frame.shape[:2]
    
    # 1. Pré-processamento da imagem para o YOLO (640x640)
    img_640 = cv2.resize(frame, (640, 640))
    img_rgb = cv2.cvtColor(img_640, cv2.COLOR_BGR2RGB)
    
    # Normalização e transposição para CHW
    input_data = img_rgb.transpose(2, 0, 1).astype(np.float32) / 255.0
    input_data = np.expand_dims(input_data, axis=0) # Batch size = 1
    
    # 2. Inferência no ONNX Runtime
    outputs = session.run(None, {input_name: input_data})
    output = outputs[0][0] # shape: (C, 8400)
    
    boxes = []
    confidences = []
    
    # YOLOv8 outputs: 4 coordenadas de bounding box (x,y,w,h) + scores para cada classe
    num_classes = output.shape[0] - 4
    
    # Filtragem das detecções baseada em threshold de confiança
    for i in range(output.shape[1]):
        classes_scores = output[4:, i]
        class_id = np.argmax(classes_scores)
        confidence = classes_scores[class_id]
        
        if confidence > 0.25:
            x_center, y_center, w, h = output[0:4, i]
            
            # Escala as coordenadas de volta para o tamanho original do frame
            x_min = int((x_center - w / 2) * (largura_orig / 640.0))
            y_min = int((y_center - h / 2) * (altura_orig / 640.0))
            box_w = int(w * (largura_orig / 640.0))
            box_h = int(h * (altura_orig / 640.0))
            
            boxes.append([x_min, y_min, box_w, box_h])
            confidences.append(float(confidence))
            
    if not boxes:
        return []
        
    # 3. Non-Maximum Suppression (NMS) para eliminar caixas sobrepostas redundantes
    indices = cv2.dnn.NMSBoxes(boxes, confidences, score_threshold=0.25, nms_threshold=0.45)
    
    recortes = []
    if len(indices) > 0:
        flat_indices = indices.flatten() if hasattr(indices, 'flatten') else indices
        for idx in flat_indices:
            x_min, y_min, w, h = boxes[idx]
            
            # Adiciona padding focal de 10% nas bordas
            pad_w = int(w * 0.1)
            pad_h = int(h * 0.1)
            
            x_start = max(0, x_min - pad_w)
            y_start = max(0, y_min - pad_h)
            x_end = min(largura_orig, x_min + w + pad_w)
            y_end = min(altura_orig, y_min + h + pad_h)
            
            crop = frame[y_start:y_end, x_start:x_end]
            if crop is not None and crop.size > 0:
                recortes.append(crop)
                
    if not recortes:
        return []
        
    # 4. Decodificação em paralelo de todos os recortes de códigos encontrados no frame
    resultados_paralelos = executor.map(processar_recorte, recortes)
    
    codigos_encontrados = []
    for res in resultados_paralelos:
        codigos_encontrados.extend(res)
        
    return codigos_encontrados

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
    # Processa cerca de 2 frames por segundo de vídeo (equilíbrio ideal entre velocidade e cobertura)
    frames_para_pular = max(1, int(fps_video / 2))
    
    frame_anterior_cinza = None
    
    # ThreadPoolExecutor com workers para processamento assíncrono em multi-core
    with ThreadPoolExecutor(max_workers=4) as executor:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            frame_count = cap.get(cv2.CAP_PROP_POS_FRAMES)
            if frame_count % frames_para_pular != 0:
                continue
            
            # Filtro de diferença de frames simples para pular trechos estáticos/redundantes
            # Redimensiona para uma escala pequena (256x256) para que a comparação seja instantânea
            frame_pequeno = cv2.resize(frame, (256, 256))
            frame_cinza = cv2.cvtColor(frame_pequeno, cv2.COLOR_BGR2GRAY)
            
            if frame_anterior_cinza is not None:
                # Calcula a diferença absoluta média das intensidades dos pixels (0.0 a 1.0)
                diff = cv2.absdiff(frame_cinza, frame_anterior_cinza)
                mean_diff = np.mean(diff) / 255.0
                
                # Se a variação de pixels do vídeo for menor que 2% (drone parado ou sem novos elementos), pula
                if mean_diff < 0.02:
                    continue
                    
            frame_anterior_cinza = frame_cinza
            
            # Executa a inteligência de localização e decodificação focal
            novos_codigos = detectar_e_decodificar(frame, executor)
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
    uvicorn.run(app, host="0.0.0.0", port=8000)