#!/usr/bin/env bash
# Instala el feed en esta máquina y lo deja corriendo.
#   bash ops/instalar.sh                 instala, construye, verifica y arranca el servidor en segundo plano
#   bash ops/instalar.sh --launchagent   igual, pero lo deja fijo como LaunchAgent del usuario (solo Mac)
#   bash ops/instalar.sh --sin-arrancar  solo instala, construye y verifica
# Es idempotente: se puede volver a correr después de un git pull.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ"
MODO="${1:-}"

echo "== 1/5 Node"
if ! command -v node >/dev/null; then
  echo "✗ no hay node. Instala Node 24 o superior (Mac: brew install node) y vuelve a correr esto."; exit 1
fi
MAYOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$MAYOR" -lt 24 ]; then
  echo "✗ node $(node -v) es viejo: hace falta 24 o superior (brew install node, o nvm install 26)."; exit 1
fi
echo "✓ node $(node -v)"

echo "== 2/5 Dependencias"
npm install --no-fund --no-audit

echo "== 3/5 Configuración"
if [ ! -f .env ]; then cp .env.example .env; echo "✓ .env creado desde .env.example (puerto 4400, tope 2 USD/día, barridos 7:00 y 19:00)"; else echo "✓ .env ya existía, no lo toco"; fi
mkdir -p data

echo "== 4/5 Interfaz"
npm run -s build

echo "== 5/5 Verificación (Node, vault, credencial del modelo)"
set +e
node --use-system-ca --env-file-if-exists=.env scripts/doctor.ts
DOCTOR=$?
set -e
if [ "$DOCTOR" -ne 0 ]; then
  echo
  echo "Hay algo pendiente arriba (normalmente la credencial). Arréglalo y corre: npm run doctor"
  echo "El servidor se puede arrancar igual con npm start; sin credencial la interfaz abre pero el agente no responde."
  exit 1
fi

PUERTO="$(grep -E '^PUERTO=' .env | cut -d= -f2 || true)"; PUERTO="${PUERTO:-4400}"
case "$MODO" in
  --sin-arrancar) echo; echo "Listo. Arranca con: npm start  →  http://127.0.0.1:$PUERTO" ;;
  --launchagent)
    bash ops/instalar-launchagent.sh
    sleep 3
    node --use-system-ca --env-file-if-exists=.env scripts/doctor.ts --servidor | tail -2
    ;;
  *)
    if curl -fs "http://127.0.0.1:$PUERTO/api/estado" >/dev/null 2>&1; then
      echo "· ya hay un servidor respondiendo en :$PUERTO, no arranco otro"
    else
      nohup node --use-system-ca --env-file-if-exists=.env server/index.ts > data/servidor.log 2>&1 &
      sleep 3
    fi
    node --use-system-ca --env-file-if-exists=.env scripts/doctor.ts --servidor | tail -2
    echo "Abre http://127.0.0.1:$PUERTO · log en data/servidor.log · para dejarlo fijo: bash ops/instalar-launchagent.sh"
    ;;
esac
