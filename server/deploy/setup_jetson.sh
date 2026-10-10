#!/usr/bin/env bash
# Run on the Jetson from the repo root:  bash server/deploy/setup_jetson.sh
# Installs the broker, the server's Python packages, builds the game screen,
# and starts everything on boot. Safe to run again.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_USER="${SUDO_USER:-$USER}"

sudo apt-get update
sudo apt-get install -y mosquitto mosquitto-clients python3-pip nodejs npm
sudo pip3 install -r "$ROOT/server/requirements.txt" pyserial --break-system-packages 2>/dev/null \
  || sudo pip3 install -r "$ROOT/server/requirements.txt" pyserial

sudo cp "$ROOT/server/deploy/mosquitto-incube.conf" /etc/mosquitto/conf.d/incube.conf
sudo systemctl enable --now mosquitto
sudo systemctl restart mosquitto

(cd "$ROOT/client" && npm install && npm run build)

sudo usermod -aG dialout "$RUN_USER"   # lets the soil bridge open the ESP32 USB port (log out and in once)

for unit in incube-server incube-client incube-bridge; do
  sed -e "s|__USER__|$RUN_USER|g" -e "s|__DIR__|$ROOT|g" "$ROOT/server/deploy/$unit.service" \
    | sudo tee "/etc/systemd/system/$unit.service" >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now incube-server incube-client incube-bridge

echo
echo "Done. Game screen: http://$(hostname).local:8080/   (or http://$(hostname -I | awk '{print $1}'):8080/)"
echo "Broker for the ESP32: $(hostname -I | awk '{print $1}'):1883"
echo "Logs: journalctl -u incube-server -f"
