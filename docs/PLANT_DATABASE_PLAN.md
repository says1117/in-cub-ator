<!-- docs/PLANT_DATABASE_PLAN.md: Plan for NFC-mapped plants with levels, types, moves and animations. Owner: shared by all roles (written by Role 1 with a Codex analysis of all branches, 2026-10-10). -->

# Plant database plan

**Goal:** each real plant has an NFC tag. A plant whose tag is on a pad is summoned: it walks behind the trainer and can fight. A plant whose tag is off the pads is not in the game. Each plant has its own level, XP, fighting type, moves, and animations for those moves.

**Rule zero:** the pumps must keep working exactly as they do today. The watering rules do not change: a won fight waters the pot that was dry, for the length set by the boss tier (at most 3000 ms), only if the soil is dry (a demo win is the one exception: it may water wet soil, as today) and the cube is online, and never more often than the reward gap. The one thing that can move is *timing*: levelled-up plants win sooner, so the watering after a fight can come a little earlier. If the team wants identical timing, set `HP_PER_LEVEL = 0` and a very large `ATK_LEVELS_PER_POINT` in `server/config.py` (levels then show but do not change stats). Tests prove both: identical commands with growth off, and every command following the rules with growth on.

**Branch for this work:** `plant-db-tests` (firmware + Role 2 server and client, from `hardware-jetson`).

## Where we are (checked on 2026-10-10)

| Part | Today |
| --- | --- |
| Hardware loop | Worked end to end on the bench: dry soil, boss, battle, win, `incube/cmd/pump/A 3000`, pump ran. |
| Pads | Firmware publishes `incube/pad/A` and `incube/pad/B` (retained, uppercase hex UID, empty when lifted). Real tags right now: pad A `0450AA01F25713`, pad B `0450A901055713`. |
| Server (Alexin) | Stores the UID per pad but does nothing with it. Both pads always field a fighter, even an empty pad (defaults Ember and Zest). `creatures.json` has fake UIDs with colons, so real tags never match. |
| Moves | Fixed attack, guard, special (rock-paper-scissors style) plus one signature skill per creature. No level, XP or type. |
| Client (Alexin) | `petParade.js` already draws plants walking behind the trainer, but always both, not based on pads. `plantRig.js` has reusable actions (strike, guard, cast, hurt, cheer, enter, leave). `data/plants.js` maps moves to animations. |
| Okayuu's branch | A SQLite table with tag ID, species, level, HP. Useful ideas (unique tag ID, saving progress, a collection screen), but it listens on different MQTT topics and runs its own battles in the browser. Reuse ideas, not the whole server. |

**Important distinction:** A and B are the physical pots (soil sensor and pump). A plant's identity follows its tag, not the pad it sits on. Watering always goes to the pot that got dry, whichever plant fights.

## Plan, in order

### Step 0: protect the pumps (Role 1, first)

1. Run `firmware/tests/integration/phase4_check.sh` against the Jetson once it is on the shared network. This is the baseline: pump runs, refuses a too-soon command, caps a long one, reports offline.
2. Keep that test passing after every later step.

### Step 1: the data (Role 2, with real UIDs from Role 1)

**Plant record** (one per physical tag):

| Field | Example |
| --- | --- |
| `plant_id` | `plant-ember` |
| `tag_uid` | `0450AA01F25713` (unique, uppercase hex, no separators) |
| `name`, `species` | `Ember`, `Cast Iron Plant` |
| `level`, `xp` | `1`, `0` |
| `type` | `grass` |
| `base_hp`, `base_atk` | `30`, `8` |
| `sprite_key`, `animation_set_key` | `ember`, `ember` |
| `moves` | `["leaf-strike", "bark-guard", "sun-burst"]` |

**Move record** (shared catalog):

| Field | Example |
| --- | --- |
| `move_id`, `name` | `leaf-strike`, `Leaf Strike` |
| `category` | `attack` / `guard` / `special` (keeps today's battle rules) |
| `type`, `power` | `grass`, `8` |
| `effect` | one of `damage`, `heal`, `block` (a fixed list, never code) |
| `cooldown_turns` | `0` |
| `animation_key` | `leaf-strike` |

**Storage:** start simple and fast.
- Plants and moves as seed JSON committed to git (`server/data/plants.json`, `server/data/moves.json`).
- Progress (level, XP) in a small SQLite file on the Jetson (`server/data/progress.db`, not committed).
- Everything is loaded into memory at start-up. The game never waits on the disk or the network during a turn.
- Unknown tags are reported as "unregistered" and summon nothing.

### Step 2: summon and unsummon (Role 2)

In `engine.on_pad()`:
- Known tag placed: that plant joins the party.
- Pad emptied: that plant leaves the party.
- The same retained message twice changes nothing.
- No plants summoned: soil still works and the drought alert shows, but no battle starts until a plant is summoned. (Today an empty pad still fights; this is a deliberate change.)
- A plant lifted mid-battle: if it is on the bench it leaves; if it is fighting, the next summoned plant steps in; if none remain, the battle is cancelled with no XP and no watering.

### Step 3: moves, XP and levels (Role 2)

- Each plant fights with its own moves, inside today's attack, guard, special rules, so balance stays close to what works now. Add type advantages later, with small bounded multipliers.
- The server only accepts moves the active plant actually has.
- On a win: XP to the plants that took part, saved once per battle. Demo battles give no XP.
- XP never affects watering. Watering stays: win, then `water_reward()`, then the pump command, with every existing limit.

### Step 4: game state message (Roles 2 and 3 agree, then write it into CONTRACT.md)

Add to the WebSocket snapshot, keeping the old fields for now:

```json
{
  "schema_version": 2,
  "pads": {
    "A": {"uid": "0450AA01F25713", "plant_id": "plant-ember", "status": "known"},
    "B": {"uid": null, "plant_id": null, "status": "empty"}
  },
  "summoned_plants": [
    {"plant_id": "plant-ember", "pad_id": "A", "name": "Ember", "level": 1, "xp": 0,
     "type": "grass", "sprite_key": "ember", "animation_set_key": "ember",
     "moves": ["leaf-strike", "bark-guard", "sun-burst"]}
  ]
}
```

Battle events gain `battle_id`, `active_plant_id`, and per turn the actor, `move_id`, `animation_key`, damage or heal.

### Step 5: the game screen (Role 3)

- The walking trail shows only `summoned_plants`, using the existing `enter` and `leave` animations when a tag goes on or off.
- Art is chosen by `sprite_key`, not by pad A or B.
- Move buttons come from the active plant's moves.
- Each `animation_key` maps to a body action plus an effect in the art catalog. Missing art falls back to a generic strike, cast or guard, so nothing breaks.
- Show level, type and XP. The storage screen can list every registered plant, marked summoned or not.

### Step 6: tests (each role, before hardware)

- Server: real UIDs, unknown tag, empty pad, repeated message, restart, the same tag on both pads, swapping tags; zero, one and two plants; lifting a plant at every battle stage; only legal moves; XP once per battle; progress survives a restart.
- **Pump regression:** the number, topic and length of pump commands must be identical before and after, including when the database fails.
- Client: parade follows summoned plants, buttons follow moves, missing-animation fallback.
- Hardware: rerun the Phase 4 script.

## Optional: Databricks (nice for the prize, never needed to play)

1. The server writes events to a local file: soil readings, pad changes, bosses, moves, XP, pump commands sent.
2. A separate uploader sends them to Databricks every few minutes, with retries. Nothing in the game waits on it.
3. In Databricks: clean the data, measure each pot's drying rate, and predict "pot A will be dry in about N minutes".
4. The prediction comes back to a local cache and shows in the game as a hint, for example "Ember will need water soon". If it is missing or old, the hint just disappears.
5. Databricks never controls pumps, limits or commands.

Pitch for the judges: real sensor data, prepared and modelled in Databricks, turned into a care prediction that changes what the player sees.

## Who owns what

| Work | Owner |
| --- | --- |
| Pump safety, relay cutoff, pad and soil messages, Phase 4 test | Role 1 (firmware) |
| Plant and move data, SQLite progress, summon logic, battles, XP, game state message, pump regression tests | Role 2 (server) |
| Trail, buttons, animation catalog and fallback, level and XP display | Role 3 (client, art) |
| Registering real tag UIDs, removal rules, the game state schema | Everyone |
| Databricks logging, upload, model, hint | Role 2, with Role 3 showing the hint |

## Risks

- **Balance:** today's tests assume two fighters. One summoned plant must still be able to win, or plants never get watered.
- **Calibration:** the server still uses placeholder soil values (3000 and 1200 instead of the measured 3430 and 1450). Fix that on its own, not together with this work, so problems are easy to trace.
- **Two servers:** keep one game server (Alexin's, which works with the hardware). Bring over Okayuu's ideas, not his server.
- **Watering is "sent", not "confirmed":** the firmware can refuse a command and the server does not know. A command-result message is a good later contract addition, but not a blocker.
