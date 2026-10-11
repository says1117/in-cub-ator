#!/usr/bin/env bash
# Opens the game fullscreen on the Jetson's own screen. Run from the desktop session:  bash server/deploy/kiosk.sh
# To start it at login:  bash server/deploy/kiosk.sh --autostart
URL="http://localhost:8080/"

if [ "${1:-}" = "--autostart" ]; then
  mkdir -p "$HOME/.config/autostart"
  cat > "$HOME/.config/autostart/incube-kiosk.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=In-cube-ator
Exec=bash $(cd "$(dirname "$0")" && pwd)/kiosk.sh
DESK
  echo "Will open the game at login."
  exit 0
fi

# wait until the game screen is being served
for _ in $(seq 1 60); do curl -sf "$URL" >/dev/null && break; sleep 1; done

if command -v chromium-browser >/dev/null; then exec chromium-browser --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required "$URL"
elif command -v chromium >/dev/null; then exec chromium --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required "$URL"
else exec firefox --kiosk "$URL"
fi
