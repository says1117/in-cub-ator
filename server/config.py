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
BATTLE_TURN_SECONDS = 4.8  # long enough for the client to call out and play both moves of a turn
SWAP_EXTRA_SECONDS = 1.6  # extra pause after a plant faints, while the next one comes in on the client
ENRAGE_EXTRA_SECONDS = 1.0  # extra pause when the boss becomes enraged, while it roars on the client
REWARD_DISPLAY_SECONDS = 6.0  # the last blow plays out, then the victory panel and the pump bar
LOSS_DISPLAY_SECONDS = 6.0    # a lost fight stays in the state message this long, for the last blow
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
# The wait between two waterings of the same plant. 0: no wait, every win waters (the owner's choice).
# The cap on one pump run (PUMP_MAX_MS) and the wet-soil rule still hold. Set a number of seconds to bring the wait back.
REWARD_MIN_GAP_SECONDS = 0.0

# Demo button: the client sends {"action": "demo_boss"} over the WebSocket
WS_ACTION_DEMO_BOSS = "demo_boss"
SOURCE_SOIL = "soil"
SOURCE_DEMO = "demo"

# Battle
DEFAULT_CREATURE_HP = 30
DEFAULT_CREATURE_ATK = 8
DEFAULT_CREATURE_SKILL = "thorn_burst"
CREATURES_FILE = "creatures.json"

# The two plants are the fighters. The plant whose dry soil called the boss goes in first.
# If it faints, the other plant steps in once, at full strength. The fight is lost when both are down.
# A plant only counts while its pad reads a tag (the NFC chip on its pot). Lift it and it leaves the
# game: no moisture meter, no boss for it, no pump for it. False treats both plants as always there
# (for a cube whose pads are not wired up yet).
PLANTS_NEED_PADS = True
SIM_PAD_TAGS = {"A": "SIM-A", "B": "SIM-B"}   # the made-up tags of --sim, not in creatures.json so the plants fight as themselves

# Every hit the player's plant lands is this much stronger, always.
PLAYER_DAMAGE_BUFF = 1.3

# A known figure on a plant's pad (creatures.json) replaces that plant's numbers.
PLANT_FIGHTERS = {
    "A": {"name": "Ember", "hp": 30, "atk": 8, "skill": "inferno_bloom"},
    "B": {"name": "Zest", "hp": 34, "atk": 7, "skill": "sunburst"},
}

# The player picks each move. The client sends {"action": "move", "move": "attack"}.
WS_ACTION_MOVE = "move"
WS_ACTION_SIM_PAD = "sim_pad"   # only with --sim: lifts or sets down plant A or B, standing in for the NFC pad
# Health potion: in a fight the player may drink one on their own move. It does not use the turn.
# The first is ready when the fight starts; after each one there is a wait before the next.
WS_ACTION_POTION = "potion"            # the client sends {"action": "potion"}
POTION_HEAL_SHARE = 0.15               # of the fighting plant's full HP
POTION_COOLDOWN_SECONDS = 25.0
# If nobody picks a move in this time the game picks one, so a fight can never hang on stage.
PLAYER_MOVE_TIMEOUT_SECONDS = 10.0

# Signature skills. Each creature has one. Every turn won with a plain move adds one charge.
# At SKILL_CHARGE_NEED charges the skill is lit: it lands whatever the boss does, then empties.
SKILL_CHARGE_NEED = 2
SKILL_CHARGE_START = 1          # a fight starts one won turn away from the skill...
SKILL_CHARGE_START_WEARY = 0    # ...unless the plants' health is under HEALTH_WEARY_BELOW
SKILLS = {
    # Ember's own: a pillar of fire. A guaranteed hit, much harder than a plain attack.
    "inferno_bloom": {"name": "Inferno Bloom", "damage_factor": 1.75},
    # Zest's own: heal 8 and a small guaranteed hit as well.
    "sunburst": {"name": "Sunburst", "heal": 8, "damage_factor": 0.75},
    # The three below are the skills a tagged figure can bring (creatures.json).
    # a guaranteed hit for the creature's full attack. The boss can still hit back this turn.
    "thorn_burst": {"name": "Thorn Burst", "damage_factor": 1.0},
    # heal 8. An attacking boss still hits.
    "photosynthesis": {"name": "Photosynthesis", "heal": 8},
    # block everything the boss does this turn, and bounce a little damage back
    "bark_shield": {"name": "Bark Shield", "block": True, "damage_factor": 0.5},
}

# Moisture tiers: how dry the plant is decides how strong the boss is.
# Every tier must stay clearly winnable, since a win waters the plant: answering every tell wins
# most fights on every tier, even when nobody is at the screen (see BalanceTests).
#   moisture 50 and above: no boss
#   under 50: tier 1   under 25: tier 2   0 (at or below 1): tier 3
TIER2_BELOW_PCT = 25
TIER3_AT_OR_BELOW_PCT = 1
BOSS_TIERS = {            # tier: (label, hp, attack). How dry the soil is decides the numbers.
    1: ("mild", 38, 9),
    2: ("dry", 44, 11),
    3: ("bone dry", 48, 13),
}

# Who the boss is does not depend on how dry it is: each time one is called, the game picks one
# of these at random, every kind equally likely. The name is what the screen shows; the picture
# and the moves for each kind are in client/src/data/bosses.js.
BOSS_KINDS = {"chomper": "Drought Chomper", "sporelings": "Sporeling Trio"}

# The wind-up. Before the player picks, the boss shows the move it is winding up and how sure
# that is. The grade is the chance that the shown move is the real one. When it is not, the
# real move is the one that beats the natural counter, and that bluff move is shown as well.
TELL_CHANCE = {"sure": 1.0, "likely": 0.75, "flip": 0.5}
# Which grades a boss gives, per tier, while calm and once enraged (weights).
TELL_MIX = {
    1: {"calm": {"sure": 1.0}, "enraged": {"likely": 0.7, "flip": 0.3}},
    2: {"calm": {"likely": 1.0}, "enraged": {"likely": 0.5, "flip": 0.5}},
    3: {"calm": {"likely": 0.5, "flip": 0.5}, "enraged": {"likely": 0.25, "flip": 0.75}},
}
# A boss at or under this share of its health is enraged from the next turn: it hits harder
# and its tells get shakier.
ENRAGE_AT = 0.5
ENRAGE_ATK_BONUS = {1: 2, 2: 2, 3: 3}
# Heavy wind-up: every Nth turn (0 = never) the boss shows a move that hits HEAVY_FACTOR hard.
HEAVY_EVERY = {1: 0, 2: 3, 3: 3}
HEAVY_FACTOR = 2.0
HEAVY_GRADE = {1: {"calm": "sure", "enraged": "sure"}, 2: {"calm": "sure", "enraged": "sure"},
               3: {"calm": "sure", "enraged": "likely"}}
BLUFF_FACTOR = 1.5      # a bluff that lands hits this much harder (never stacked with heavy)
BOSS_HIT_CAP = 24       # no single boss hit takes more than this, so one mistake never ends a fight
# A boss that sees the same plain move twice running shows the move that beats it, this often.
ANTI_REPEAT = {1: 0.5, 2: 0.75, 3: 0.9}
CLASH_SHARE = 0.5       # a tie: the plant takes this share of a plain boss hit, rounded down
TIER_HINTS = (1,)       # on these tiers the move cards say WIN, CLASH or LOSE against the tell

# Overall health fades while the plant is dry and recovers when it is not (percent per second)
HEALTH_DECAY_PER_SEC = {1: 1.0, 2: 2.5, 3: 5.0}
HEALTH_RECOVER_PER_SEC = 3.0
# Winning a fight perks the plant up straight away
HEALTH_WIN_BONUS = 25.0
# Health bands shown to the player. At 0 the plant is wilted: it hits weaker, but it can still
# win, and winning waters it, so it always has a way back.
HEALTH_WEARY_BELOW = 60.0
HEALTH_WILTING_BELOW = 30.0
WILTED_ATK_FACTOR = 0.8

# Temporary random moisture simulator (python3 main.py --sim)
SIM_COOLDOWN_SECONDS = 30.0
SIM_START_PCT = {"A": (60.0, 68.0), "B": (86.0, 96.0)}  # A starts drier, so they do not dry together
SIM_DRY_PCT_PER_SEC = (0.25, 0.45)      # how fast the soil dries: 50 points takes about 2 to 3 minutes
SIM_WATER_PCT_PER_SECOND_OF_PUMP = 30.0
SIM_WATERED_AT_LEAST_PCT = 80.0         # a watering always leaves the soil at least this wet
SIM_SOAK_SECONDS = 20.0                 # freshly watered soil holds its moisture this long
