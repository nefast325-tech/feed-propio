#!/usr/bin/env bash
# Deja el servidor del feed corriendo siempre que el Mac esté encendido (LaunchAgent del usuario).
#   bash ops/instalar-launchagent.sh            instala o reinstala
#   bash ops/instalar-launchagent.sh --estado   muestra si está cargado
#   bash ops/instalar-launchagent.sh --quitar   lo descarga y borra
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
ETIQUETA=com.feed-propio.servidor
DESTINO="$HOME/Library/LaunchAgents/$ETIQUETA.plist"
case "${1:-}" in
  --estado) launchctl print "gui/$(id -u)/$ETIQUETA" 2>/dev/null | grep -E 'state|pid' || echo "no está cargado"; exit 0 ;;
  --quitar) launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true; rm -f "$DESTINO"; echo "quitado"; exit 0 ;;
esac
NODE="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents" "$RAIZ/data"
sed -e "s|__NODE__|$NODE|g" -e "s|__RAIZ__|$RAIZ|g" -e "s|__PATH__|$(dirname "$NODE"):/usr/bin:/bin|g" -e "s|__HOME__|$HOME|g" \
  "$RAIZ/ops/$ETIQUETA.plist" > "$DESTINO"
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DESTINO"
echo "instalado: $DESTINO (log en $RAIZ/data/servidor.log)"
