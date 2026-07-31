"""
Diagnóstico de Detecção de Barcodes no Vídeo do Drone
- Extrai 20 frames espaçados e tenta decodificar com múltiplas estratégias
- Testa resolução nativa vs reduzida
- Testa tiles (dividir frame em quadrantes)
"""
import cv2
import zxingcpp
import numpy as np
import time
import re
import os

VIDEO = r"backend\videos_drone\DJI_20260731101745_0266_D.MP4"

def sanitizar_codigo(texto):
    if not texto:
        return ""
    return re.sub(r'[^a-zA-Z0-9\s\(\),;\.\-]', '', texto)

def tentar_decodificar(img_gray, label=""):
    codigos = set()
    try:
        for r in zxingcpp.read_barcodes(img_gray):
            if r.valid and r.text:
                codigos.add(sanitizar_codigo(r.text.strip()))
    except: pass
    try:
        adap = cv2.adaptiveThreshold(img_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 10)
        for r in zxingcpp.read_barcodes(adap):
            if r.valid and r.text:
                codigos.add(sanitizar_codigo(r.text.strip()))
    except: pass
    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        contraste = clahe.apply(img_gray)
        for r in zxingcpp.read_barcodes(contraste):
            if r.valid and r.text:
                codigos.add(sanitizar_codigo(r.text.strip()))
    except: pass
    try:
        kernel = np.array([[-1,-1,-1],[-1,9,-1],[-1,-1,-1]])
        sharp = cv2.filter2D(img_gray, -1, kernel)
        for r in zxingcpp.read_barcodes(sharp):
            if r.valid and r.text:
                codigos.add(sanitizar_codigo(r.text.strip()))
    except: pass
    return codigos

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"Video: {fps}fps, {total} frames, {w}x{h}, {total/fps:.1f}s")

test_frames = [int(i * total / 20) for i in range(20)]
todos_codigos_1024 = set()
todos_codigos_nativo = set()
todos_codigos_tiles = set()

for idx, frame_no in enumerate(test_frames):
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
    ret, frame = cap.read()
    if not ret:
        continue
    gray_nativo = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    escala = 1024 / max(h, w)
    frame_small = cv2.resize(frame, (int(w*escala), int(h*escala)), interpolation=cv2.INTER_AREA)
    gray_small = cv2.cvtColor(frame_small, cv2.COLOR_BGR2GRAY)
    codigos_1024 = tentar_decodificar(gray_small)
    todos_codigos_1024.update(codigos_1024)
    codigos_nativo = tentar_decodificar(gray_nativo)
    todos_codigos_nativo.update(codigos_nativo)
    codigos_tiles = set()
    meio_h, meio_w = h // 2, w // 2
    tiles = [
        gray_nativo[0:meio_h, 0:meio_w],
        gray_nativo[0:meio_h, meio_w:w],
        gray_nativo[meio_h:h, 0:meio_w],
        gray_nativo[meio_h:h, meio_w:w],
        gray_nativo[h//4:3*h//4, w//4:3*w//4],
    ]
    for tile in tiles:
        codigos_tiles.update(tentar_decodificar(tile))
    todos_codigos_tiles.update(codigos_tiles)
    encontrados = codigos_1024 | codigos_nativo | codigos_tiles
    if encontrados:
        print(f"\n Frame {frame_no} ({frame_no/fps:.1f}s): {len(encontrados)} codigos")
        for c in encontrados:
            src = []
            if c in codigos_1024: src.append("1024px")
            if c in codigos_nativo: src.append("nativo")
            if c in codigos_tiles: src.append("tiles")
            print(f"  [{','.join(src)}] {c[:80]}")
cap.release()
print(f"\n{'='*60}")
print(f"RESUMO COMPARATIVO:")
print(f"  Resolucao 1024px (atual): {len(todos_codigos_1024)} codigos unicos")
print(f"  Resolucao Nativa 1080p:   {len(todos_codigos_nativo)} codigos unicos")
print(f"  Tiles (4 quadrantes):     {len(todos_codigos_tiles)} codigos unicos")
print(f"  TOTAL COMBINADO:          {len(todos_codigos_1024 | todos_codigos_nativo | todos_codigos_tiles)} codigos unicos")
somente_nativo = todos_codigos_nativo - todos_codigos_1024
somente_tiles = todos_codigos_tiles - todos_codigos_1024
if somente_nativo:
    print(f"\n  PERDIDOS pela reducao a 1024px ({len(somente_nativo)}):")
    for c in somente_nativo:
        print(f"    {c[:80]}")
if somente_tiles:
    print(f"\n  GANHOS EXTRAS pelas tiles ({len(somente_tiles - somente_nativo)}):")
    for c in (somente_tiles - somente_nativo):
        print(f"    {c[:80]}")
