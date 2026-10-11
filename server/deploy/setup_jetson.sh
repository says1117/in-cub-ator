#!/usr/bin/env bash
# server/deploy/setup_jetson.sh: One-shot install of broker, Python env and service on the Jetson. Owner: Role 2 (server).
# Usage (on the Jetson, from anywhere):  sudo bash server/deploy/setup_jetson.sh
# Safe to re-run. Needs internet once (apt + pip).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash $0"; exit 1; fi
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
echo "Repo: $REPO   Service user: $RUN_USER"

echo "== 1/5 apt packages"
apt-get update -y
apt-get install -y mosquitto mosquitto-clients python3-venv python3-pip python3-opencv curl

echo "== 2/5 Mosquitto"
install -m 644 "$REPO/server/deploy/mosquitto.conf" /etc/mosquitto/conf.d/incube.conf
systemctl enable mosquitto
systemctl restart mosquitto

echo "== 3/5 Python environment (server/.venv, sees the JetPack OpenCV)"
sudo -u "$RUN_USER" python3 -m venv --system-site-packages "$REPO/server/.venv"
sudo -u "$RUN_USER" "$REPO/server/.venv/bin/pip" install --upgrade pip
sudo -u "$RUN_USER" "$REPO/server/.venv/bin/pip" install -r "$REPO/server/requirements.txt"

echo "== 4/5 Tests"
(cd "$REPO/server" && sudo -u "$RUN_USER" .venv/bin/python -m pytest -q)

echo "== 5/5 systemd service"
sed -e "s|@REPO@|$REPO|g" -e "s|@USER@|$RUN_USER|g" "$REPO/server/deploy/incube-server.service" \
  > /etc/systemd/system/incube-server.service
[ -f "$REPO/server/deploy/server.env" ] || sudo -u "$RUN_USER" cp "$REPO/server/deploy/server.env.example" "$REPO/server/deploy/server.env"
systemctl daemon-reload
systemctl enable --now incube-server
sleep 2
systemctl --no-pager --lines=5 status incube-server || true

IP="$(hostname -I | awk '{print $1}')"
cat <<MSG

Done.
  Game screen (open on any device on the same Wi-Fi):  http://$IP:8000/
  MQTT broker for the ESP32 (secrets.h MQTT host):     $IP  port 1883
  Logs:    journalctl -u incube-server -f
  Test:    python3 $REPO/server/tools/fake_publisher.py   (fake cube, no hardware)
Write the IP in NOTES.md (Jetson address).
MSG
