import subprocess
import sys
import os
import re
import time

print("==================================================")
print("🚀 INICIANDO SERVIÇOS DO BACKEND DE IA - VIDEPLAST")
print("==================================================")

DIR_PROJETO = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR_PROJETO)

# 1. Identifica o Python do ambiente virtual se existir, senao usa o do sistema
python_exe = os.path.join(DIR_PROJETO, "backend", "venv", "Scripts", "python.exe")
if not os.path.exists(python_exe):
    python_exe = sys.executable

main_py = os.path.join(DIR_PROJETO, "backend", "main.py")

# 2. Inicia o servidor Python FastAPI na porta 8000
print("▶️ Ligando servidor FastAPI (main.py)...")
backend_process = subprocess.Popen(
    [python_exe, main_py],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

time.sleep(2)
if backend_process.poll() is not None:
    print("❌ Erro ao iniciar o backend FastAPI!")
    sys.exit(1)

print("✅ Backend FastAPI rodando na porta 8000.")

# 3. Inicia o Cloudflare Tunnel
print("⏳ Criando túnel seguro Cloudflare...")
tunnel_process = subprocess.Popen(
    ["cloudflared", "tunnel", "--url", "http://127.0.0.1:8000"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

cloudflare_url = None
inicio_espera = time.time()

while time.time() - inicio_espera < 30:
    line = tunnel_process.stdout.readline()
    if not line:
        time.sleep(0.1)
        continue
    
    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
    if match:
        cloudflare_url = match.group(0)
        break

if not cloudflare_url:
    print("⚠️ Não foi possível capturar a URL do Cloudflare automaticamente em 30s.")
    print("Servidores continuarão rodando em segundo plano.")
else:
    print("\n==================================================")
    print(f"🎉 TÚNEL CLOUDFLARE CONECTADO COM SUCESSO:")
    print(f"👉 {cloudflare_url}")
    print("==================================================\n")

    # A) Atualiza cloudflare_url.txt
    try:
        with open("cloudflare_url.txt", "w", encoding="utf-8") as f:
            f.write(f"{cloudflare_url}\n")
        print("✅ cloudflare_url.txt atualizado.")
    except Exception as e:
        print(f"⚠️ Erro ao atualizar cloudflare_url.txt: {e}")

    # B) Atualiza .env
    if os.path.exists(".env"):
        try:
            with open(".env", "r", encoding="utf-8") as f:
                env_content = f.read()
            env_content = re.sub(r"VITE_API_URL=.*", f"VITE_API_URL={cloudflare_url}", env_content)
            with open(".env", "w", encoding="utf-8") as f:
                f.write(env_content)
            print("✅ Arquivo .env atualizado.")
        except Exception as e:
            print(f"⚠️ Erro ao atualizar .env: {e}")

    # C) Atualiza ProcessadorDrone.jsx
    drone_file = os.path.join("src", "components", "ProcessadorDrone.jsx")
    if os.path.exists(drone_file):
        try:
            with open(drone_file, "r", encoding="utf-8") as f:
                content = f.read()
            content = re.sub(
                r'const URL_ATUAL_FIXA = "https://[a-zA-Z0-9-]+\.trycloudflare\.com";',
                f'const URL_ATUAL_FIXA = "{cloudflare_url}";',
                content
            )
            with open(drone_file, "w", encoding="utf-8") as f:
                f.write(content)
            print("✅ ProcessadorDrone.jsx atualizado com a nova URL.")
        except Exception as e:
            print(f"⚠️ Erro ao atualizar ProcessadorDrone.jsx: {e}")

    # D) Automatiza o Git Commit e Push
    print("\n🔄 Sincronizando com GitHub / Render (Git Commit & Push)...")
    try:
        subprocess.run(["git", "add", "src/components/ProcessadorDrone.jsx", "cloudflare_url.txt", ".env"], check=True)
        res_commit = subprocess.run(["git", "commit", "-m", f"chore: atualiza URL do tunel Cloudflare para {cloudflare_url}"], capture_output=True, text=True)
        
        if res_commit.returncode == 0 or "nothing to commit" in res_commit.stdout or "nothing to commit" in res_commit.stderr:
            print("▶️ Enviando atualização para o GitHub / Render...")
            res_push = subprocess.run(["git", "push", "origin", "master"], capture_output=True, text=True)
            if res_push.returncode == 0:
                print("🚀 Deploy no Render acionado automaticamente via Git Push!")
            else:
                print(f"⚠️ Git Push automático falhou (pode exigir credenciais): {res_push.stderr.strip()}")
        else:
            print(f"⚠️ Commit status: {res_commit.stdout.strip()}")
    except Exception as e:
        print(f"⚠️ Erro no processo do Git: {e}")

print("\n==================================================")
print("🟢 SERVIÇOS ATIVOS! Mantenha esta janela aberta.")
print("Pressione Ctrl+C para encerrar o backend e o túnel.")
print("==================================================\n")

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\n🛑 Encerrando serviços...")
    backend_process.terminate()
    tunnel_process.terminate()
    print("👋 Backend e túnel desligados com sucesso.")
