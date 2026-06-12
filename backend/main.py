from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import shutil
import os

app = FastAPI()

# Permite que o seu React faça requisições
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/processar-drone")
async def processar_video_drone(file: UploadFile = File(...)):
    # 1. Salva o vídeo temporariamente no servidor
    temp_filename = f"temp_{file.filename}"
    with open(temp_filename, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 2. Inicializa o OpenCV
    cap = cv2.VideoCapture(temp_filename)
    codigos_encontrados = set()
    
    # Inicializa o detector nativo do OpenCV (Sem precisar do pyzbar)
    detector = cv2.QRCodeDetector()
    
    frame_count = 0
    frames_para_pular = 10 

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break # Fim do vídeo
        
        frame_count += 1
        if frame_count % frames_para_pular != 0:
            continue

        # 3. Tratamento de Imagem
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # 4. Leitura do QR Code com OpenCV nativo
        # O detectAndDecodeMulti consegue achar vários QRs na mesma imagem
        retval, decoded_info, points, _ = detector.detectAndDecodeMulti(gray)
        
        if retval:
            for qr_text in decoded_info:
                if qr_text: # Garante que o texto não é vazio
                    codigos_encontrados.add(qr_text)

    # 5. Limpeza
    cap.release()
    os.remove(temp_filename)

    return {
        "sucesso": True,
        "total_encontrados": len(codigos_encontrados),
        "codigos": list(codigos_encontrados)
    }