# Instalação das dependências:
# pip install opencv-python fastapi uvicorn zxing-cpp numpy python-multipart

from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
import cv2
import shutil
import os
import numpy as np
import zxingcpp
import uuid
import re
import time

app = FastAPI()

# 6. Configuração de CORS Restritiva
ORIGENS_PERMITIDAS = [
    "https://inventario-bobinas.onrender.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
]

CORS_ORIGINS_ENV = os.environ.get("CORS_ORIGINS")
if CORS_ORIGINS_ENV:
    ORIGENS_PERMITIDAS.extend(CORS_ORIGINS_ENV.split(","))

# Remove duplicatas
ORIGENS_PERMITIDAS = list(set(ORIGENS_PERMITIDAS))

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENS_PERMITIDAS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Proteção de Acesso (Autenticação baseada em API Key)
API_KEY_NAME = "X-API-KEY"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)
API_KEY = os.environ.get("API_KEY", "videplast_segredo_padrao_2026")

async def verificar_api_key(api_key: str = Security(api_key_header)):
    if not api_key or api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Acesso negado: API Key inválida.")
    return api_key

# 5. Sanitização de Dados (Evita Injeção sem quebrar delimitadores e marcas do negócio como parênteses)
def sanitizar_codigo(texto):
    if not texto:
        return ""
    # Permite letras, números, espaços, parênteses (necessário para tag (7)), vírgula, ponto, ponto-e-vírgula e hífen.
    # Qualquer outro caractere (como aspas, menor/maior que, barras) é removido.
    return re.sub(r'[^a-zA-Z0-9\s\(\),;\.\-]', '', texto)

DIR_ATUAL = os.path.dirname(os.path.abspath(__file__))

def decodificar_frame(frame):
    """Aplica os filtros de imagem e lê todos os códigos presentes no frame via ZXing de forma progressiva (Early Exit)."""
    codigos_do_frame = []
    try:
        # Otimização: Limita o tamanho máximo do frame para reduzir pixels a processar
        altura, largura = frame.shape[:2]
        max_dim = 1024
        if max(altura, largura) > max_dim:
            escala = max_dim / max(altura, largura)
            nova_largura = int(largura * escala)
            nova_altura = int(altura * escala)
            frame = cv2.resize(frame, (nova_largura, nova_altura), interpolation=cv2.INTER_AREA)

        frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # 1. Tenta decodificar a imagem original em escala de cinza (mais rápido)
        try:
            resultados = zxingcpp.read_barcodes(frame_gray)
            for r in resultados:
                if r.valid and r.text:
                    texto_sanitizado = sanitizar_codigo(r.text.strip())
                    if texto_sanitizado and texto_sanitizado not in codigos_do_frame:
                        codigos_do_frame.append(texto_sanitizado)
        except Exception:
            pass

        # Early Exit: se já encontrou códigos, pula a geração de filtros pesados
        if codigos_do_frame:
            return codigos_do_frame

        # 2. Tenta com Threshold Adaptativo (excelente para curvas e sombras)
        try:
            adaptativo = cv2.adaptiveThreshold(
                frame_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10
            )
            resultados = zxingcpp.read_barcodes(adaptativo)
            for r in resultados:
                if r.valid and r.text:
                    texto_sanitizado = sanitizar_codigo(r.text.strip())
                    if texto_sanitizado and texto_sanitizado not in codigos_do_frame:
                        codigos_do_frame.append(texto_sanitizado)
        except Exception:
            pass

        if codigos_do_frame:
            return codigos_do_frame

        # 3. Tenta com CLAHE (Contraste)
        try:
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            contraste = clahe.apply(frame_gray)
            resultados = zxingcpp.read_barcodes(contraste)
            for r in resultados:
                if r.valid and r.text:
                    texto_sanitizado = sanitizar_codigo(r.text.strip())
                    if texto_sanitizado and texto_sanitizado not in codigos_do_frame:
                        codigos_do_frame.append(texto_sanitizado)
                        
            if codigos_do_frame:
                return codigos_do_frame

            # 4. Tenta com Otsu sobre o CLAHE
            _, otsu = cv2.threshold(contraste, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            resultados = zxingcpp.read_barcodes(otsu)
            for r in resultados:
                if r.valid and r.text:
                    texto_sanitizado = sanitizar_codigo(r.text.strip())
                    if texto_sanitizado and texto_sanitizado not in codigos_do_frame:
                        codigos_do_frame.append(texto_sanitizado)
        except Exception:
            pass

    except Exception as e:
        print(f"[ZXing Error] Erro ao processar frame: {e}")
        
    return codigos_do_frame

@app.post("/api/processar-drone")
async def processar_video_drone(
    file: UploadFile = File(...),
    api_key: str = Security(verificar_api_key)
):
    tempo_inicio = time.time()

    # 2. Whitelisting de extensões permitidas
    EXTENSOES_PERMITIDAS = {".mp4", ".mov", ".avi"}
    _, extensao = os.path.splitext(file.filename)
    extensao = extensao.lower()
    if extensao not in EXTENSOES_PERMITIDAS:
        raise HTTPException(
            status_code=400, 
            detail="Formato de arquivo não permitido. Apenas .mp4, .mov e .avi são aceitos."
        )

    # 2. Limite de tamanho de arquivo (trava de 600MB)
    LIMITE_TAMANHO_BYTES = 600 * 1024 * 1024  # 600MB
    if file.size and file.size > LIMITE_TAMANHO_BYTES:
        raise HTTPException(
            status_code=413, 
            detail="Arquivo muito grande. O tamanho máximo permitido é 600MB."
        )

    pasta_temp = os.path.join(DIR_ATUAL, "temp_processamento")
    if not os.path.exists(pasta_temp):
        os.makedirs(pasta_temp)
        
    # 3. Gerenciamento Seguro com UUID para evitar Path Traversal
    temp_filename = os.path.join(pasta_temp, f"temp_{uuid.uuid4()}{extensao}")
    
    duracao_video = 0.0
    try:
        # 2. Salva o arquivo em chunks monitorando limite de tamanho em tempo real
        tamanho_acumulado = 0
        with open(temp_filename, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)  # Lê blocos de 1MB
                if not chunk:
                    break
                tamanho_acumulado += len(chunk)
                if tamanho_acumulado > LIMITE_TAMANHO_BYTES:
                    buffer.close()
                    if os.path.exists(temp_filename):
                        os.remove(temp_filename)
                    raise HTTPException(
                        status_code=413, 
                        detail="Arquivo excede o limite permitido de 600MB."
                    )
                buffer.write(chunk)

        cap = cv2.VideoCapture(temp_filename)
        fps_video = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
        duracao_video = total_frames / fps_video if fps_video > 0 else 0.0

        codigos_encontrados = set()
        # Alterado de 5 fps para 3 fps para acelerar o processamento mantendo a excelente cobertura de detecção
        frames_para_pular = max(1, int(fps_video / 3))
        
        frame_anterior_cinza = None
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            # Filtro de movimento de frames simples
            frame_pequeno = cv2.resize(frame, (256, 256))
            frame_cinza = cv2.cvtColor(frame_pequeno, cv2.COLOR_BGR2GRAY)
            
            processar = True
            if frame_anterior_cinza is not None:
                diff = cv2.absdiff(frame_cinza, frame_anterior_cinza)
                mean_diff = np.mean(diff) / 255.0
                
                # Pula frames com movimento irrelevante (menos de 0.5% de variação de pixels)
                if mean_diff < 0.005:
                    processar = False
                    
            frame_anterior_cinza = frame_cinza
            
            if processar:
                # Decodifica o frame aplicando os filtros
                novos_codigos = decodificar_frame(frame)
                for cod in novos_codigos:
                    codigos_encontrados.add(cod)

            # Otimização: Pula a decodificação de frames intermediários usando cap.grab()
            for _ in range(frames_para_pular - 1):
                if not cap.grab():
                    break

        cap.release()

    finally:
        # 4. Robustez e LGPD (Data Purge garantido via finally)
        try:
            if os.path.exists(temp_filename):
                os.remove(temp_filename)
        except Exception as e:
            print(f"[Limpeza] Erro ao remover arquivo temporário {temp_filename}: {e}")

    tempo_fim = time.time()
    tempo_processamento = tempo_fim - tempo_inicio

    return {
        "sucesso": True,
        "total_encontrados": len(codigos_encontrados),
        "codigos": list(codigos_encontrados),
        "tempo_processamento": round(tempo_processamento, 2),
        "duracao_video": round(duracao_video, 2)
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)