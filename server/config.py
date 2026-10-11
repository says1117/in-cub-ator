# server/config.py: Every server number in one place. Owner: Role 2 (server).
"""All tunables. Most can be overridden with INCUBE_* environment variables."""
import os
from pathlib import Path


def _env(name, default, cast=str):
    raw = os.getenv("INCUBE_" + name)
    if raw is None or raw == "":
        return default
    if cast is bool:
        return raw.lower() in ("1", "true", "yes", "on")
    return cast(raw)


ROOT = Path(__file__).resolve().parent
CLIENT_DIR = ROOT.parent / "client"
DATA_DIR = ROOT / "data"
PROGRESS_FILE = Path(_env("PROGRESS_FILE", str(DATA_DIR / "progress.json")))

# --- Network -------------------------------------------------------------
MQTT_HOST = _env("MQTT_HOST", "localhost")
MQTT_PORT = _env("MQTT_PORT", 1883, int)
MQTT_USER = _env("MQTT_USER", "")
MQTT_PASSWORD = _env("MQTT_PASSWORD", "")
HTTP_HOST = _env("HTTP_HOST", "0.0.0.0")
HTTP_PORT = _env("HTTP_PORT", 8000, int)

# --- Soil calibration (ESP32 12-bit ADC, capacitive sensor: HIGHER = DRIER) ---
# These are placeholder defaults. Replace with the real numbers from
# firmware/calibration.md (and mirror them in NOTES.md).
SOIL = {
    "A": {"air": 3200, "water": 1300, "dry_at": 2600, "wet_at": 2000},
    "B": {"air": 3200, "water": 1300, "dry_at": 2600, "wet_at": 2000},
}
# dry_at: raw >= this summons a boss.  wet_at: raw <= this dismisses it (hysteresis).

# --- Game timing ---------------------------------------------------------
TICK_SECONDS = 0.5            # main loop period
PUMP_MS = _env("PUMP_MS", 3000, int)          # water per boss win (firmware also caps this)
WATER_SETTLE_SECONDS = _env("WATER_SETTLE", 45, int)   # wait for soil to wet after a pump run
SOIL_STALE_SECONDS = 30       # soil reading older than this counts as unknown
EVENT_LOG_SIZE = 12

# --- Light / vision (optional) -------------------------------------------
VISION_ENABLED = _env("VISION", False, bool)
CAMERA = _env("CAMERA", "0")              # index (USB) or a full GStreamer pipeline string
VISION_INTERVAL = 5.0
AUTO_LIGHT = _env("AUTO_LIGHT", False, bool)   # turn grow light on when it is dark
LIGHT_LOW_PERCENT = 25        # sunlight % below this triggers the grow light
LIGHT_MINUTES = _env("LIGHT_MINUTES", 30, int)
LIGHT_COOLDOWN_SECONDS = 35 * 60
