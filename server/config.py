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
TOPIC_STATUS_ESP32 = "incube/status/esp32"
TOPIC_DEBUG_BOSS = "incube/debug/boss"

# Soil calibration. PLACEHOLDERS until Role 1 writes real values in the shared notes.
# Works whether the sensor reads high or low when dry: percent 0 = dry, 100 = wet.
SOIL_RAW_DRY = 3000
SOIL_RAW_WET = 1200
SOIL_DRY_THRESHOLD_PCT = 50   # below this for N readings in a row summons a boss
SOIL_WET_THRESHOLD_PCT = 55   # above this dismisses a boss (hysteresis)
SOIL_DRY_READINGS_N = 5

# Timings (seconds)
BOSS_INTRO_SECONDS = 5.2  # long enough for the boss arrival animation on the client
BATTLE_TURN_SECONDS = 2.6  # move lockout after each turn: the client plays both moves of the turn
SWAP_EXTRA_SECONDS = 1.6  # extra pause after a plant faints, while the next one comes in on the client
UNLEASH_EXTRA_SECONDS_PER_BLOOM = 0.3  # extra pause after a skill that spent blooms, per bloom
RESULT_HOLD_SECONDS = 6.0  # the finished fight stays in the state message this long after ANY end
REWARD_DISPLAY_SECONDS = 6.0  # the last blow plays out, then the victory panel and the pump bar
COOLDOWN_SECONDS = 60.0
BOSS_BREATHER_SECONDS = 20.0  # after any fight ends, no plant can call a boss for this long
ESP32_STALE_SECONDS = 30.0

# Reward safety.
# PUMP_MAX_MS is the hard cap on any pump command. It is a conservative PLACEHOLDER until Role 1
# gives the firmware's real cap: it must never be higher than that. Raise it only with Role 1.
# A harder boss gives more water, but always inside the cap.
PUMP_MAX_MS = 3000
PUMP_MS_PER_WIN = 2000
PUMP_MS_BY_TIER = {1: 2000, 2: 2500, 3: 3000}
REWARD_MIN_GAP_SECONDS = COOLDOWN_SECONDS   # per plant: no two pumps closer than this
# Rolling budget per plant: all pump time in the last hour, plus the new command, stays within this.
PUMP_BUDGET_MS_PER_HOUR = 12000
PUMP_BUDGET_WINDOW_SECONDS = 3600.0
# A beaten demo boss on wet soil gives only a sip (gap, budget and cap still apply).
DEMO_SIP_MS = 500
# Every pump command is logged here (wall clock) so the gap and the budget survive a restart.
# Git-ignored. A corrupt file counts as one full pump per plant just now.
PUMP_LOG_FILE = "var/pump_log.json"

# Demo button: the client sends {"action": "demo_boss"} over the WebSocket
WS_ACTION_DEMO_BOSS = "demo_boss"
SOURCE_SOIL = "soil"
SOURCE_DEMO = "demo"

# Battle (placeholder rules until the original game's numbers are confirmed)
DEFAULT_CREATURE_HP = 30
DEFAULT_CREATURE_ATK = 8
DEFAULT_CREATURE_SKILL = "thorn_burst"
CREATURES_FILE = "creatures.json"

# The two plants are the fighters. The plant whose dry soil called the boss goes in first.
# If it faints, the other plant steps in once, at full strength. The fight is lost when both are down.
# A known figure on a plant's pad (creatures.json) replaces that plant's numbers.
PLANT_FIGHTERS = {
    "A": {"name": "Ember", "hp": 30, "atk": 8, "skill": "inferno_bloom"},
    "B": {"name": "Zest", "hp": 34, "atk": 7, "skill": "sunburst"},
}

# The player picks each move. The client sends {"action": "move", "move": "attack"}.
WS_ACTION_MOVE = "move"
# If nobody picks a move in this time the game picks one, so a fight can never hang on stage.
PLAYER_MOVE_TIMEOUT_SECONDS = 8.0
# After one timed-out turn the game is "idle" and plays itself a turn every AUTO_TURN_SECONDS until
# anyone presses a move. Headless (no screen connected) fights use the same pace.
AUTO_TURN_SECONDS = 3.2
AUTOPILOT_READ_CHANCE = 0.4    # how often the autopilot counters a shown intent
AUTOPILOT_HEAL_MIN_SHARE = 0.6  # a heal is only used when this much of it would land

# Boss intents: each turn the boss decides its next move and shows it with this chance (else "?").
# A shown intent is always true.
INTENT_SHOW_RATE = {1: 0.75, 2: 0.65, 3: 0.60}

# Blooms: each turn won adds one (up to BLOOM_MAX), a boss hit wipes them, the skill spends them:
# effect x (1 + BLOOM_BONUS x blooms).
BLOOM_MAX = 3
BLOOM_BONUS = 0.5

# Signature skills. Each creature has one. The skill always goes through, then it needs
# SKILL_COOLDOWN_TURNS turns before it can be used again.
SKILL_COOLDOWN_TURNS = 4
SKILLS = {
    # Ember's own: a pillar of fire. A guaranteed hit, harder than a plain attack.
    "inferno_bloom": {"name": "Inferno Bloom", "damage_factor": 1.25},
    # Zest's own: heal 8 and a small guaranteed hit as well.
    "sunburst": {"name": "Sunburst", "heal": 8, "damage_factor": 0.5},
    # The three below are the skills a tagged figure can bring (creatures.json).
    # a guaranteed hit for the creature's full attack. The boss can still hit back this turn.
    "thorn_burst": {"name": "Thorn Burst", "damage_factor": 1.0},
    # heal 8. An attacking boss still hits.
    "photosynthesis": {"name": "Photosynthesis", "heal": 8},
    # block everything the boss does this turn, and bounce a little damage back
    "bark_shield": {"name": "Bark Shield", "block": True, "damage_factor": 0.5},
}

# Moisture tiers: how dry the plant is decides how strong the boss is.
#   moisture 50 and above: no boss
#   under 50: tier 1   under 25: tier 2   0 (at or below 1): tier 3
# Every tier must stay winnable, since a win waters the plant. Rule: nobody does worse than in the
# old game (always-Attack 95.4/92.9/86.9%, masher 99.4/99.2/96.3%), minus at most 1 point. Tuned
# against test_balance.py (20k seeded fights per tier, both lead orders):
#   tier  always-Attack  masher  autopilot  reader (turns)  reader/masher turns
#   1     95.7%          99.75%  100%       100% (4.8)      0.36
#   2     94.3%          99.6%   99.98%     100% (5.6)      0.40
#   3     88.2%          98.3%   99.86%     100% (6.7)      0.43
# masher = random move + skill whenever ready; reader = counters shown intents, cashes blooms in.
TIER2_BELOW_PCT = 25
TIER3_AT_OR_BELOW_PCT = 1
BOSS_TIERS = {            # tier: (name, hp, attack)
    1: ("Drought Chomper", 30, 6),
    2: ("Parched Brute", 34, 6),
    3: ("Desert Dragon", 38, 7),
}

# Overall health fades while the plant is dry and recovers when it is not (percent per second).
# It is a mood shown to the player only: it does not change the fight.
HEALTH_DECAY_PER_SEC = {1: 1.0, 2: 2.5, 3: 5.0}
HEALTH_RECOVER_PER_SEC = 3.0
# Winning a fight perks the plant up straight away
HEALTH_WIN_BONUS = 25.0
HEALTH_WEARY_BELOW = 60.0
HEALTH_WILTING_BELOW = 30.0

# State message version sent to the game screen
PROTOCOL_VERSION = 2

# Temporary random moisture simulator (python3 main.py --sim)
SIM_COOLDOWN_SECONDS = 30.0
SIM_START_PCT = {"A": (60.0, 68.0), "B": (86.0, 96.0)}  # A starts drier, so they do not dry together
SIM_DRY_PCT_PER_SEC = (0.25, 0.45)      # how fast the soil dries: 50 points takes about 2 to 3 minutes
SIM_WATER_PCT_PER_SECOND_OF_PUMP = 30.0
SIM_WATERED_AT_LEAST_PCT = 80.0         # a watering always leaves the soil at least this wet
SIM_SOAK_SECONDS = 20.0                 # freshly watered soil holds its moisture this long
