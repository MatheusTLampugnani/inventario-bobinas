# Instalação das dependências:
# pip install opencv-python fastapi uvicorn zxing-cpp numpy python-multipart

from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Security, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel
import cv2
import shutil
import os
import numpy as np
import zxingcpp
import uuid
import re
import time

app = FastAPI()

# 6. Configuração de CORS Permissiva
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.options("/{full_path:path}")
async def options_handler(full_path: str):
    return {"status": "ok"}

@app.get("/")
@app.get("/api/health")
async def health_check():
    return {"status": "online", "servico": "Backend Drone Videplast"}

# 1. Proteção de Acesso (Autenticação baseada em API Key)
API_KEY_NAME = "X-API-KEY"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)
API_KEY = os.environ.get("API_KEY", "videplast_segredo_padrao_2026")

async def verificar_api_key(request: Request, api_key: str = Security(api_key_header)):
    if request.method == "OPTIONS":
        return None
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
DIR_VIDEOS_DRONE = os.path.join(DIR_ATUAL, "videos_drone")
if not os.path.exists(DIR_VIDEOS_DRONE):
    os.makedirs(DIR_VIDEOS_DRONE)

# Gerenciador global em memória para tarefas de IA
TAREFAS_DRONE = {}

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

import threading

def _executar_processamento_background(task_id: str, caminho_video: str, eh_temporario: bool):
    try:
        tempo_inicio = time.time()
        cap = cv2.VideoCapture(caminho_video)
        if not cap.isOpened():
            TAREFAS_DRONE[task_id] = {
                "status": "erro",
                "erro": "Não foi possível abrir o arquivo de vídeo."
            }
            return

        fps_video = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duracao_video = total_frames / fps_video if fps_video > 0 else 0.0

        codigos_encontrados = set()
        frames_para_pular = max(1, int(fps_video / 2))
        frame_anterior_cinza = None
        frame_idx = 0

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            porcentagem = int((frame_idx / total_frames) * 100) if total_frames > 0 else 0
            TAREFAS_DRONE[task_id]["porcentagem"] = min(99, porcentagem)
            TAREFAS_DRONE[task_id]["total_encontrados"] = len(codigos_encontrados)

            frame_pequeno = cv2.resize(frame, (256, 256))
            frame_cinza = cv2.cvtColor(frame_pequeno, cv2.COLOR_BGR2GRAY)
            
            processar = True
            if frame_anterior_cinza is not None:
                diff = cv2.absdiff(frame_cinza, frame_anterior_cinza)
                mean_diff = np.mean(diff) / 255.0
                if mean_diff < 0.005:
                    processar = False
                    
            frame_anterior_cinza = frame_cinza
            
            if processar:
                novos_codigos = decodificar_frame(frame)
                for cod in novos_codigos:
                    codigos_encontrados.add(cod)

            frame_idx += 1
            for _ in range(frames_para_pular - 1):
                if not cap.grab():
                    break
                frame_idx += 1

        cap.release()
        tempo_fim = time.time()
        tempo_processamento = tempo_fim - tempo_inicio

        TAREFAS_DRONE[task_id] = {
            "status": "concluido",
            "sucesso": True,
            "porcentagem": 100,
            "total_encontrados": len(codigos_encontrados),
            "codigos": list(codigos_encontrados),
            "tempo_processamento": round(tempo_processamento, 2),
            "duracao_video": round(duracao_video, 2)
        }

    except Exception as e:
        print(f"[IA Task Error] Erro no processamento em background: {e}")
        TAREFAS_DRONE[task_id] = {
            "status": "erro",
            "erro": str(e)
        }
    finally:
        if eh_temporario and os.path.exists(caminho_video):
            try:
                os.remove(caminho_video)
            except Exception:
                pass

class ProcessarLocalPayload(BaseModel):
    filename: str

@app.get("/api/videos-locais")
def listar_videos_locais(api_key: str = Security(verificar_api_key)):
    if not os.path.exists(DIR_VIDEOS_DRONE):
        os.makedirs(DIR_VIDEOS_DRONE)
    
    EXTENSOES_PERMITIDAS = {".mp4", ".mov", ".avi"}
    arquivos = []
    
    for f in os.listdir(DIR_VIDEOS_DRONE):
        ext = os.path.splitext(f)[1].lower()
        if ext in EXTENSOES_PERMITIDAS:
            full_path = os.path.join(DIR_VIDEOS_DRONE, f)
            if os.path.isfile(full_path):
                stat = os.stat(full_path)
                tamanho_mb = round(stat.st_size / (1024 * 1024), 2)
                data_mod = time.strftime('%d/%m/%Y %H:%M', time.localtime(stat.st_mtime))
                arquivos.append({
                    "nome": f,
                    "tamanho_mb": tamanho_mb,
                    "data_modificacao": data_mod
                })
    
    return {
        "caminho_pasta": DIR_VIDEOS_DRONE,
        "total": len(arquivos),
        "arquivos": arquivos
    }

@app.get("/api/status-drone/{task_id}")
def obter_status_drone(task_id: str, api_key: str = Security(verificar_api_key)):
    if task_id not in TAREFAS_DRONE:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return TAREFAS_DRONE[task_id]

@app.post("/api/processar-drone-local")
def processar_video_drone_local(
    payload: ProcessarLocalPayload,
    api_key: str = Security(verificar_api_key)
):
    nome_seguro = os.path.basename(payload.filename)
    caminho_completo = os.path.abspath(os.path.join(DIR_VIDEOS_DRONE, nome_seguro))
    
    if not caminho_completo.startswith(os.path.abspath(DIR_VIDEOS_DRONE)):
        raise HTTPException(status_code=400, detail="Caminho de arquivo inválido.")
    
    if not os.path.exists(caminho_completo):
        raise HTTPException(status_code=404, detail=f"Arquivo '{nome_seguro}' não encontrado na pasta {DIR_VIDEOS_DRONE}.")
    
    task_id = str(uuid.uuid4())
    TAREFAS_DRONE[task_id] = {
        "status": "processando",
        "porcentagem": 0,
        "total_encontrados": 0
    }
    
    t = threading.Thread(
        target=_executar_processamento_background,
        args=(task_id, caminho_completo, False),
        daemon=True
    )
    t.start()

    return {
        "sucesso": True,
        "task_id": task_id,
        "status": "processando"
    }

@app.post("/api/processar-drone")
def processar_video_drone(
    file: UploadFile = File(...),
    api_key: str = Security(verificar_api_key)
):
    EXTENSOES_PERMITIDAS = {".mp4", ".mov", ".avi"}
    _, extensao = os.path.splitext(file.filename)
    extensao = extensao.lower()
    if extensao not in EXTENSOES_PERMITIDAS:
        raise HTTPException(
            status_code=400, 
            detail="Formato de arquivo não permitido. Apenas .mp4, .mov e .avi são aceitos."
        )

    LIMITE_TAMANHO_BYTES = 600 * 1024 * 1024  # 600MB
    if file.size and file.size > LIMITE_TAMANHO_BYTES:
        raise HTTPException(
            status_code=413, 
            detail="Arquivo muito grande. O tamanho máximo permitido é 600MB."
        )

    pasta_temp = os.path.join(DIR_ATUAL, "temp_processamento")
    if not os.path.exists(pasta_temp):
        os.makedirs(pasta_temp)
        
    temp_filename = os.path.join(pasta_temp, f"temp_{uuid.uuid4()}{extensao}")
    
    try:
        tamanho_acumulado = 0
        with open(temp_filename, "wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
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

        task_id = str(uuid.uuid4())
        TAREFAS_DRONE[task_id] = {
            "status": "processando",
            "porcentagem": 0,
            "total_encontrados": 0
        }
        
        t = threading.Thread(
            target=_executar_processamento_background,
            args=(task_id, temp_filename, True),
            daemon=True
        )
        t.start()

        return {
            "sucesso": True,
            "task_id": task_id,
            "status": "processando"
        }

    except Exception as e:
        if os.path.exists(temp_filename):
            try:
                os.remove(temp_filename)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)