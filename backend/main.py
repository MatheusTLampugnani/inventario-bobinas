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

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# ============================================================
# Motor de IA v2 — Resolução Nativa + Tiles + Paralelismo
# ============================================================
# Diagnóstico real mostrou:
#   - 1024px: 7 códigos | Nativa 1080p: 9 códigos | Tiles: 8 códigos
#   - 2 códigos PERDIDOS pela redução a 1024px
#   - Tiles recuperam códigos pequenos que o frame inteiro não pega
# ============================================================

KERNEL_SHARPEN = np.array([[-1,-1,-1],[-1,9,-1],[-1,-1,-1]], dtype=np.float32)

def _decodificar_rapido(img_gray):
    """Decodificação rápida: apenas gray direto + sharpening. Para uso no frame inteiro."""
    codigos = set()
    try:
        for r in zxingcpp.read_barcodes(img_gray):
            if r.valid and r.text:
                t = sanitizar_codigo(r.text.strip())
                if t: codigos.add(t)
        if codigos:
            return codigos
    except Exception:
        pass
    try:
        sharp = cv2.filter2D(img_gray, -1, KERNEL_SHARPEN)
        for r in zxingcpp.read_barcodes(sharp):
            if r.valid and r.text:
                t = sanitizar_codigo(r.text.strip())
                if t: codigos.add(t)
    except Exception:
        pass
    return codigos


def _decodificar_completo(img_gray):
    """Decodificação completa com todos os filtros. Para uso nas tiles."""
    codigos = set()
    
    # 1. Gray direto
    try:
        for r in zxingcpp.read_barcodes(img_gray):
            if r.valid and r.text:
                t = sanitizar_codigo(r.text.strip())
                if t: codigos.add(t)
        if codigos:
            return codigos
    except Exception:
        pass

    # 2. Sharpening
    try:
        sharp = cv2.filter2D(img_gray, -1, KERNEL_SHARPEN)
        for r in zxingcpp.read_barcodes(sharp):
            if r.valid and r.text:
                t = sanitizar_codigo(r.text.strip())
                if t: codigos.add(t)
        if codigos:
            return codigos
    except Exception:
        pass

    # 3. Threshold Adaptativo
    try:
        adap = cv2.adaptiveThreshold(img_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10)
        for r in zxingcpp.read_barcodes(adap):
            if r.valid and r.text:
                t = sanitizar_codigo(r.text.strip())
                if t: codigos.add(t)
        if codigos:
            return codigos
    except Exception:
        pass

    # 4. CLAHE + Otsu
    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        contraste = clahe.apply(img_gray)
        for r in zxingcpp.read_barcodes(contraste):
            if r.valid and r.text:
                t = sanitizar_codigo(r.text.strip())
                if t: codigos.add(t)
        if codigos:
            return codigos
        _, otsu = cv2.threshold(contraste, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        for r in zxingcpp.read_barcodes(otsu):
            if r.valid and r.text:
                t = sanitizar_codigo(r.text.strip())
                if t: codigos.add(t)
    except Exception:
        pass

    return codigos


def decodificar_frame_v2(frame):
    """Motor v2: Resolução nativa com early exit + Tiles sob demanda."""
    codigos_total = set()
    try:
        altura, largura = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # === Passo 1: Frame inteiro — decodificação RÁPIDA (gray + sharpen) ===
        codigos_total.update(_decodificar_rapido(gray))
        if codigos_total:
            return list(codigos_total)  # Early exit — não precisa de tiles

        # === Passo 2: Tiles (só se frame inteiro não encontrou nada) ===
        meio_h, meio_w = altura // 2, largura // 2
        tiles = [
            gray[0:meio_h, 0:meio_w],              # top-left
            gray[0:meio_h, meio_w:largura],         # top-right
            gray[meio_h:altura, 0:meio_w],          # bottom-left
            gray[meio_h:altura, meio_w:largura],    # bottom-right
            gray[altura//4:3*altura//4, largura//4:3*largura//4],  # centro
        ]
        for tile in tiles:
            codigos_total.update(_decodificar_completo(tile))

        # === Passo 3: Fallback 50% (se nada encontrado ainda) ===
        if not codigos_total and max(altura, largura) > 1280:
            frame_small = cv2.resize(gray, (largura // 2, altura // 2), interpolation=cv2.INTER_AREA)
            codigos_total.update(_decodificar_completo(frame_small))

    except Exception as e:
        print(f"[ZXing Error] Erro ao processar frame: {e}")

    return list(codigos_total)


def _processar_frame_worker(frame, codigos_globais_lock, codigos_encontrados):
    """Worker para processamento paralelo de frames."""
    novos = decodificar_frame_v2(frame)
    if novos:
        with codigos_globais_lock:
            for cod in novos:
                codigos_encontrados.add(cod)
    return len(novos)


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
        largura = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        altura = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        codigos_encontrados = set()
        codigos_lock = threading.Lock()

        # v2: Amostragem a 4fps (dobro do anterior) para não perder etiquetas visíveis brevemente
        frames_para_pular = max(1, int(fps_video / 4))
        frame_anterior_cinza = None
        frame_idx = 0
        frames_processados = 0

        print(f"[IA v2] Processando: {os.path.basename(caminho_video)}")
        print(f"[IA v2] Video: {largura}x{altura} @ {fps_video}fps, {total_frames} frames, {duracao_video:.1f}s")
        print(f"[IA v2] Amostragem: 1 frame a cada {frames_para_pular} ({fps_video/frames_para_pular:.1f} fps efetivo)")
        print(f"[IA v2] Motor: Resolução nativa + 5 tiles + sharpening + fallback 50%")

        # ThreadPoolExecutor para processar frames em paralelo (IO-bound pelo decode do ZXing)
        max_workers = min(4, os.cpu_count() or 2)
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                porcentagem = int((frame_idx / total_frames) * 100) if total_frames > 0 else 0
                TAREFAS_DRONE[task_id]["porcentagem"] = min(99, porcentagem)
                TAREFAS_DRONE[task_id]["total_encontrados"] = len(codigos_encontrados)

                # Filtro de movimento: descarta frames estáticos (câmera parada)
                frame_pequeno = cv2.resize(frame, (256, 256))
                frame_cinza = cv2.cvtColor(frame_pequeno, cv2.COLOR_BGR2GRAY)

                processar = True
                if frame_anterior_cinza is not None:
                    diff = cv2.absdiff(frame_cinza, frame_anterior_cinza)
                    mean_diff = np.mean(diff) / 255.0
                    # v2: Threshold mais baixo (0.003 vs 0.005) para não descartar frames úteis
                    if mean_diff < 0.003:
                        processar = False

                frame_anterior_cinza = frame_cinza

                if processar:
                    # Submete o frame para processamento paralelo
                    future = executor.submit(_processar_frame_worker, frame.copy(), codigos_lock, codigos_encontrados)
                    futures.append(future)
                    frames_processados += 1

                    # Limita o backlog de futures para não estourar memória
                    if len(futures) > max_workers * 3:
                        done_futures = [f for f in futures if f.done()]
                        futures = [f for f in futures if not f.done()]

                frame_idx += 1
                for _ in range(frames_para_pular - 1):
                    if not cap.grab():
                        break
                    frame_idx += 1

            # Aguarda todos os futures pendentes completarem
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as e:
                    print(f"[IA v2 Worker Error] {e}")

        cap.release()
        tempo_fim = time.time()
        tempo_processamento = tempo_fim - tempo_inicio

        print(f"[IA v2] Concluído: {len(codigos_encontrados)} códigos em {tempo_processamento:.1f}s")
        print(f"[IA v2] Frames processados: {frames_processados} de {total_frames} ({frames_processados/max(1,total_frames)*100:.1f}%)")

        TAREFAS_DRONE[task_id] = {
            "status": "concluido",
            "sucesso": True,
            "porcentagem": 100,
            "total_encontrados": len(codigos_encontrados),
            "codigos": list(codigos_encontrados),
            "tempo_processamento": round(tempo_processamento, 2),
            "duracao_video": round(duracao_video, 2),
            "frames_processados": frames_processados,
            "motor_versao": "v2"
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
    
    EXTENSOES_PERMITIDAS = {".mp4", ".mov", ".avi", ".lrf"}
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
    EXTENSOES_PERMITIDAS = {".mp4", ".mov", ".avi", ".lrf"}
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