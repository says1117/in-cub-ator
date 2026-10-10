"""Every tunable number for the server lives here."""

# Network
MQTT_HOST = "localhost"
MQTT_PORT = 1883
WS_HOST = "0.0.0.0"
WS_PORT = 8765

PLANTS = ("A", "B")

# MQTT topics (shared contract, change only with all three roles)
TOPIC_PAD = "incube/pad/{plant}"
TOPIC_SOIL = "incube/soil/{plant}"
TOPIC_CMD_PUMP = "incube/cmd/pump/{plant}"
TOPIC_CMD_LIGHT = "incube/cmd/light"
TOPIC_STATUS_ESP32 = "incube/status/esp32"
TOPIC_DEBUG_BOSS = "incube/debug/boss"

# Soil calibration. PLACEHOLDERS until Role 1 writes real values in the shared notes.
# Works whether the sensor reads high or low when dry: percent 0 = dry, 100 = wet.
SOIL_RAW_DRY = 3000
SOIL_RAW_WET = 1200
SOIL_DRY_THRESHOLD_PCT = 30   # below this for N readings in a row summons a boss
SOIL_WET_THRESHOLD_PCT = 60   # above this dismisses a boss (hysteresis)
SOIL_DRY_READINGS_N = 5

# Timings (seconds)
BOSS_INTRO_SECONDS = 3.0
BATTLE_TURN_SECONDS = 1.5
REWARD_DISPLAY_SECONDS = 4.0
COOLDOWN_SECONDS = 60.0
ESP32_STALE_SECONDS = 30.0

# Reward safety. Must not exceed the firmware cap agreed with Role 1.
PUMP_MS_PER_WIN = 3000
PUMP_MAX_MS = 5000
LIGHT_MINUTES_PER_WIN = 30
LIGHT_MAX_MINUTES = 60
REWARD_MIN_GAP_SECONDS = COOLDOWN_SECONDS

# Demo button: the client sends {"action": "demo_boss"} over the WebSocket
WS_ACTION_DEMO_BOSS = "demo_boss"
SOURCE_SOIL = "soil"
SOURCE_DEMO = "demo"

# Battle (placeholder rules until the original game's numbers are confirmed)
BOSS_HP = 30
BOSS_ATK = 5
DEFAULT_CREATURE_HP = 30
DEFAULT_CREATURE_ATK = 5
CREATURES_FILE = "creatures.json"
