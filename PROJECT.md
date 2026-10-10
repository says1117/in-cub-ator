# In-cube-ator: how the whole thing works

Two plants in a cube, with a pixel game attached. A little dragon walks through a forest on
screen, and the two plants hop along behind it as its pets. When a plant's soil gets dry, a
boss jumps into the forest. The dragon sends the thirsty plant in to fight it. Beat the boss
and the real pump waters the real plant. Lose, and the plant stays thirsty until the next fight.

This file explains every part and every game rule. The numbers quoted here all live in
`server/config.py`; if this file and that one disagree, `config.py` is right.

## Contents

1. [The parts](#1-the-parts)
2. [How the parts talk](#2-how-the-parts-talk)
3. [The game loop: five modes](#3-the-game-loop-five-modes)
4. [Soil moisture and boss tiers](#4-soil-moisture-and-boss-tiers)
5. [Plant health](#5-plant-health)
6. [The battle](#6-the-battle)
7. [The two plants and their skills](#7-the-two-plants-and-their-skills)
8. [Rewards and pump safety](#8-rewards-and-pump-safety)
9. [What happens when the hardware goes quiet](#9-what-happens-when-the-hardware-goes-quiet)
10. [The demo button](#10-the-demo-button)
11. [The game screen](#11-the-game-screen)
12. [The boss entrance, step by step](#12-the-boss-entrance-step-by-step)
13. [The Drought Chomper](#13-the-drought-chomper)
14. [Running it](#14-running-it)
15. [File map](#15-file-map)
16. [What is placeholder or not built yet](#16-what-is-placeholder-or-not-built-yet)

---

## 1. The parts

| Part | What it is | Where |
| --- | --- | --- |
| Hardware | An ESP32 with two soil sensors, two pumps, a grow light and NFC pads | Role 1, `steven-hardware` branch |
| Message broker | Mosquitto (MQTT), the post office between the ESP32 and the server | runs on port 1883 |
| Game server | Python. Owns every rule: when a boss appears, who wins, when to water | `server/` |
| Game screen | A Phaser 4 web game. Draws what the server says and sends the player's moves | `client/` |

There are two plants, called **A** and **B**. Each has its own soil sensor, pump and pad.

The server is the only place that decides anything. The game screen never decides who wins
or whether to water. It only shows the server's state and sends button presses back. This
means two screens show the same fight, and a broken screen cannot flood a plant.

## 2. How the parts talk

```
ESP32  --MQTT-->  broker  --MQTT-->  game server  --WebSocket-->  game screen
ESP32  <--MQTT--  broker  <--MQTT--  game server  <--WebSocket--  game screen
       (pump on)                     (rules)                      (moves, demo button)
```

### MQTT topics (ESP32 and server)

| Topic | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `incube/soil/A`, `incube/soil/B` | ESP32 to server | a raw sensor number, e.g. `2310` | soil reading |
| `incube/pad/A`, `incube/pad/B` | ESP32 to server | an NFC tag ID, or empty | which creature is on the pad |
| `incube/status/esp32` | ESP32 to server | `online` or anything else | is the ESP32 alive |
| `incube/cmd/pump/A`, `incube/cmd/pump/B` | server to ESP32 | milliseconds, e.g. `2000` | run this pump for this long |
| `incube/cmd/light` | server to ESP32 | minutes | grow light (defined, not used yet) |
| `incube/debug/boss` | laptop to server | `A` or `B` | force a boss for that plant |

### WebSocket (server and game screen), port 8765

The server sends the **whole game state** as one JSON message every time anything changes.
It checks five times a second. The screen sends two kinds of message back:

```json
{"action": "demo_boss"}
{"action": "move", "move": "attack"}
```

`move` is one of `attack`, `guard`, `special`, `skill`.

### The state message

```json
{
  "mode": "battle",
  "creatures": {"A": "04:A1:B2:C3", "B": null},
  "meters": {"water": {"A": 31.5, "B": 100.0}, "sunlight": {"A": null, "B": null}, "stale": false},
  "fighters": {"A": {"name": "Ember", "skill": "Thorn Burst"}, "B": {"name": "Zest", "skill": "Photosynthesis"}},
  "health": 72.4,
  "condition": "healthy",
  "tier": 1,
  "boss": {"plant": "A", "name": "Drought Chomper", "tier": 1, "hp": 20, "max_hp": 28,
           "type": "drought", "source": "soil"},
  "battle": {"turn": 2, "plant": "A",
             "team": {"A": {"name": "Ember", "hp": 23, "max_hp": 30, "state": "fighting"},
                      "B": {"name": "Zest", "hp": 34, "max_hp": 34, "state": "ready"}},
             "creature": "Ember", "creature_hp": 23, "creature_max_hp": 30,
             "boss_hp": 20, "last_move": {"creature": "attack", "boss": "special", "hit": "creature"},
             "skill": {"name": "Thorn Burst", "ready": true, "ready_in": 0},
             "manual": true, "awaiting_move": true, "move_seconds_left": 8},
  "reward": {"type": "water", "plant": "A", "size": 2000, "tier": 1}
}
```

- `boss` and `battle` are `null` when there is none.
- `battle.plant` is the plant fighting right now. `battle.team` lists both plants: `fighting`,
  `ready` (waiting on the bench) or `down` (fainted). `creature`, `creature_hp` and `skill`
  always describe the one that is fighting.
- When a plant faints and the other steps in, that turn's `last_move` also carries
  `"swap": {"out": "A", "in": "B", "name": "Zest"}`.
- `reward` is the **last** reward given. It stays in the state after the fight.
- `boss.source` is `soil` for a real dry-soil boss and `demo` for the demo button.
- `reward.size` is pump time in milliseconds.

## 3. The game loop: five modes

The server is always in exactly one mode.

```
            soil dry for 5 readings,          5.2 s
            or demo button                    pass
 WALKING ---------------------------> BOSS ----------> BATTLE
    ^                                   |                 |
    |                                   | soil got wet    | win            lose
    |                                   v                 v                 |
    |<------------------------------ (boss leaves)     REWARD               |
    |                                                     | 4 s             |
    |              cooldown ends                          v                 |
    +<------------------------------------------------ COOLDOWN <-----------+
```

| Mode | What is happening | How long |
| --- | --- | --- |
| `walking` | The dragon walks. Nothing is wrong. | until the soil dries |
| `boss` | The boss is arriving. The screen plays the entrance. | 5.2 seconds |
| `battle` | Turn-based fight. | until someone hits 0 HP |
| `reward` | You won. The pump runs and the victory panel shows. | 4 seconds |
| `cooldown` | No new boss for this plant. | 60 seconds after the fight (15 in sim mode) |

Rules worth knowing:

- **A boss leaves on its own if the soil gets wet.** If someone waters the plant by hand
  during the arrival or the fight, and the reading rises above 55%, the boss is dismissed
  and the game goes back to walking. This only applies to real soil bosses, not demo ones.
- **Cooldown is per plant.** After a fight for plant A, plant B can still call a boss.
- **A drier plant can skip the cooldown.** If the soil has dropped into a harder tier than
  the last boss, a new boss comes straight away.
- **If both plants are dry, the drier one goes first.**

## 4. Soil moisture and boss tiers

The sensor gives a raw number. The server turns it into a percentage: 0% is bone dry,
100% is wet. The two calibration numbers are `SOIL_RAW_DRY` (3000) and `SOIL_RAW_WET`
(1200). They are placeholders until the real sensors are measured.

| Moisture | Tier | Boss | Boss HP | Boss attack | Water on a win |
| --- | --- | --- | --- | --- | --- |
| 50% and above | 0 | none | | | |
| under 50% | 1 | Drought Chomper | 28 | 7 | 2.0 s |
| under 25% | 2 | Parched Brute | 36 | 8 | 2.5 s |
| 1% or lower | 3 | Desert Dragon | 44 | 10 | 3.0 s |

A drier plant gets a harder boss and a bigger drink. Every tier is meant to stay winnable,
because winning is the only way the plant gets watered. With both plants on the team and
random moves, tier 1 is won almost every time, tier 2 about 97% of the time and tier 3
about 75%. On tier 3 the first plant is knocked out in about three fights out of four.

If both plants are dry at once, the **drier one** calls the boss and fights first.

**Two things stop a boss from flickering in and out:**

- A boss only appears after **5 dry readings in a row** (below 50%). One odd reading does
  nothing.
- A boss appears below 50% but only leaves above **55%**. The gap means a reading hovering
  around 50% does not summon and dismiss a boss over and over.

## 5. Plant health

Health is one number from 0 to 100 for the whole cube. It is separate from moisture: it
shows how long the plant has been neglected.

- While any plant is dry, health drops: 1% per second at tier 1, 2.5% at tier 2, 5% at tier 3.
- While every plant is fine, health climbs back at 3% per second.
- Winning a fight adds 25 straight away.

| Health | Condition shown | Effect |
| --- | --- | --- |
| 60 and above | healthy | none |
| under 60 | weary | none |
| under 30 | wilting | none |
| 0 | wilted | both plants' attack is cut to 80% |

A wilted plant can still fight and still win, and a win waters it. There is always a way back.

## 6. The battle

One sentence: **each turn you and the boss both pick attack, guard or special; attack beats
special, special beats guard, guard beats attack; whoever wins the turn hits for their
attack number; a tie does nothing.**

```
   attack  --beats-->  special  --beats-->  guard  --beats-->  attack
```

- The boss always picks at random.
- The dragon does not fight. It sends in a plant. The plant has HP and an attack number, and
  so does the boss.
- **The thirsty plant goes first**: the one whose dry soil called the boss.
- **If it faints, the other plant steps in**, once, at full HP and with its own skill ready.
  The boss keeps whatever HP it had left. The fight is lost only when both plants are down.
- Whichever plant lands the last hit, the water goes to the plant that called the boss.
- Your fourth button is the fighting plant's **skill** (next section).

**Timing**

- You have **10 seconds** to pick. If you do not, the game picks for you: the skill if it
  is ready, otherwise a random move. A fight can never hang.
- After each turn there is a 1.2 second pause before the next move is accepted, so the
  screen has time to show what happened. A turn where a plant faints adds 1.6 seconds, for
  the other plant to come in.
- If **no game screen is connected**, the server plays the whole fight by itself, one turn
  every 1.2 seconds. The plant still gets watered if it wins.

## 7. The two plants and their skills

The fighters are the two plants themselves (`PLANT_FIGHTERS` in `server/config.py`):

| Plant | Name | Looks like | HP | Attack | Skill |
| --- | --- | --- | --- | --- | --- |
| A | Ember | an anthurium with red flowers | 30 | 8 | Thorn Burst |
| B | Zest | a striped lemon-lime dracaena | 34 | 7 | Photosynthesis |

Each plant pad can also hold an NFC-tagged figure. A tag listed in `server/creatures.json`
replaces that plant's name and numbers for the fight. A tag that is not in the file, or an
empty pad, leaves the plant as it is.

| Figure | HP | Attack | Skill |
| --- | --- | --- | --- |
| Thornback | 30 | 8 | Thorn Burst |
| Mossling | 36 | 6 | Photosynthesis |
| Barkhorn | 32 | 7 | Bark Shield |

A skill **always works**, whatever the boss picked. After you use it, it needs **4 turns**
to recharge. Pressing skill while it is recharging counts as a plain attack.

| Skill | What it does | Can the boss still hit you that turn? |
| --- | --- | --- |
| Thorn Burst | hits for your full attack | yes, if the boss picked attack |
| Photosynthesis | heals 8 HP (never above your maximum) | yes, if the boss picked attack |
| Bark Shield | blocks everything and bounces back half your attack | no |

**Adding a skill or a move later** takes three small steps, and the first is the only one
that changes the rules:

1. The rule: add the skill to `SKILLS` in `server/config.py` and give it to a plant in
   `PLANT_FIGHTERS`. `battle.py` already understands `damage_factor`, `heal` and `block`.
2. The body: how the plant moves is an "action" in `client/src/render/plantRig.js` (strike,
   guard, cast, hurt, hop, cheer and so on). An action is one small function that turns a few
   dials (lift, lean, stretch, arms open, a named arm pose). The notes at the top of that
   file explain how to add one.
3. The effect: what flies across the screen is a function in `client/src/render/battleFx.js`
   (punch, shield, petals, thorns, sunlight, bark). `client/src/data/plants.js` says which
   action and which effect go with each move and each skill, per plant.

## 8. Rewards and pump safety

Winning sends one pump command: `incube/cmd/pump/A` with a time in milliseconds.

The server refuses to send it unless all of these are true:

1. **The soil is not already wet.** At 55% or above, no water. (A demo boss is the one
   exception, so the demo works on stage with wet soil.)
2. **The last reward for this plant was at least 60 seconds ago.**
3. **The ESP32 is online.** If it has gone quiet, no command is sent.
4. **The time is capped.** No pump command is ever longer than `PUMP_MAX_MS` (3000 ms),
   whatever the tier table says.

The firmware has its own hard cap as well. The server's cap must never be higher than the
firmware's. Losing sends nothing.

## 9. What happens when the hardware goes quiet

The readings are marked **stale** when either:

- the ESP32 publishes anything other than `online` on its status topic, or
- no soil reading has arrived for **30 seconds**.

When that happens:

- a boss that is arriving, or a fight in progress, is dropped and the game goes back to walking;
- no pump command is sent, even for a fight that was just won;
- the state message carries `meters.stale: true` so the screen can say so.

The moment any soil reading arrives again, the readings count as fresh.

## 10. The demo button

The red **DEMO BOSS** button on the game screen summons a boss without waiting for dry
soil. It is for showing the project on stage.

- It picks the plant that has a creature on its pad. If both or neither has one, it picks
  the plant with less water.
- The boss's tier follows that plant's real moisture, with tier 1 as the minimum.
- It is ignored while a boss, fight or reward is already active.
- After the boss appears, everything is the normal flow. Winning runs the pump, even on wet
  soil, but the 60 second gap and the pump cap still apply.

A laptop can do the same by publishing `A` or `B` to `incube/debug/boss`.

## 11. The game screen

The screen is a Phaser 4 game, 800 by 450, drawn in code with a few picture files.

| Scene | Address | What it is |
| --- | --- | --- |
| `AdventureScene` | `/` or `/adventure` | The forest walk. The dragon walks forever through a painted enchanted forest: wisteria, glowing runes, crystals, mushrooms, a lily pond. The two plants hop along behind it. |
| `BossScene` | `/boss` | The battle screen, in the style of a monster-battle game: the fighting plant at the front left, the boss at the back right, the dragon and the other plant waiting behind. |
| `StorageScene` | `/storage` | A placeholder plant list. Not wired to anything. |

**On top of the game** sits a small panel (`ui/statusBar.js`): water bars for A and B, a
sunlight bar (empty for now), the health bar, the condition, a "BOSS ALERT" banner, the
connection status and the demo button.

**The two plants in the forest**

- They follow the dragon and hop **in turns**: one is never in the air while the other is.
- Each is built from moving pieces: its arms and loose leaves sway on their own, its leaves
  bend like grass, it breathes and blinks. Everything loose is on a spring, so arms and
  leaves trail behind a hop and wobble when it lands.
- A plant whose soil is under 50% looks thirsty: it droops, hops lower and slower, and
  sweats now and then.
- When a boss is spotted they both jump in fright. The landing blows them back. Then the
  dragon calls the thirsty one ("GO, EMBER!"), which bounds to the front with an angry
  face, while the other one hides behind the dragon and shakes.
- After a win they bounce and beam while the reward is on screen.

**The plants in the battle**

- The dragon stands at the back left and waves the plant in. The fighting plant is up front;
  the other waits small beside the dragon and hops when its friend lands a hit.
- Each move has its own body action and effect: a lunge and punch for attack, a leaf dome
  for guard, a flurry of petals for special, thorns or sunbeams for the skills.
- A plant that reaches 0 HP tips over. It is carried to the bench and the other plant bounds
  in from the bench, growing as it comes forward. A strip under the title shows both plants'
  HP and whether each is fighting, ready or down.

**How the screen follows the server**

- Every state message is stored where any scene can read it (`registry.get("serverState")`).
- `AdventureScene` watches the mode. When it becomes `boss`, it plays the entrance. When the
  entrance is finished and the mode is `battle`, it cuts to `BossScene`.
- If the mode leaves `boss` before the fight (the soil got wet, or the ESP32 dropped), the
  entrance is cancelled and everything it moved is put back.
- If the page is loaded in the middle of a fight, it goes straight to the battle screen.
- `BossScene` shows the HP bars, the turn number, the countdown and a log line, all from
  the state. The four buttons (or keys 1 to 4) send a move, and only work while the server
  is waiting for one.
- When the fight ends it shows VICTORY with the real pump time ("Water • Pump A • 2.0 s"),
  or DEFEAT, then returns to the forest.

## 12. The boss entrance, step by step

This is the part built to look good on stage. It lasts about 4.5 seconds, inside the
server's 5.2 second `boss` mode. All of it is in `client/src/render/bossEntrance.js`.

1. **Spotted.** A dark shape with two red eyes appears deep between the trees. A "!" pops
   over the dragon, which jumps.
2. **Two bounds toward the camera.** The boss does not come in from the side. It comes
   *at* you: each bound it gets bigger, lower on the screen and less blue and hazy, with
   a flat shadow on the ground beneath it and fading after-images behind it.
3. **Impact frames.** It lands in the grass behind the dragon. For about a fifth of a
   second the screen is pure white with black cut-outs, then inverted with speed lines,
   then white again. Clods of earth hang frozen in the air.
4. **The ground breaks.** A crater with cracks, shockwave rings spreading along the ground,
   dust, nearby plants and rocks thrown clear, the trees shuddering, petals shaken loose,
   and the nearest big tree snapping above its roots and toppling away from the fight.
5. **The dragon turns around.** It is shoved back by the blast, then spins to face the
   boss, which leaves its back to the camera. The two plants are blown back with it.
6. **The roar.** Cinema bars close in, the boss's name plate slides on, the dragon calls
   the thirsty plant to the front, and the boss roars (next section). The forest darkens
   and the camera shakes.
7. **Cut.** Two flashes, a fade, and the battle screen opens.

When the fight is over and the forest comes back, the crater is gone, the plants are back
and the tree is standing again.

## 13. The Drought Chomper

The boss is a thorny plant with three hanging flower heads. One picture is used for all
three tiers for now; higher tiers are drawn a little taller.

It is not one flat picture. It was cut into eight layers so each can move on its own
(`client/src/render/bossRig.js`, with the layer positions in `client/src/data/chomperRig.js`):

- **Idle.** The three heads and three leaves each swing at their own speed, so they never
  line up and the motion never visibly repeats. The whole plant leans and breathes, and the
  middle head's mouth parts slightly.
- **Roar.** The middle head swings up toward the dragon and splits open along the crack in
  its petals. Inside is a glowing red orb with a dark halo and two rows of teeth. The other
  heads flare outward and the leaves flutter.

It roars once when it lands in the forest, and again in battle every time it lands a hit.

While it is in the air during the entrance it is the flat picture; it switches to the
moving version at the start of the roar.

**Adding a new boss picture:** put the file in `client/public/assets/bosses/` and change
that tier's line in `client/src/data/bosses.js`. A boss without layers works too: it just
does not sway or open its mouth.

## 14. Running it

You need Python 3, Node, and Mosquitto.

```bash
brew install mosquitto
```

**Without any hardware** (made-up moisture for both plants):

```bash
mosquitto
```

```bash
cd server && pip install -r requirements.txt && python3 main.py --sim
```

```bash
cd client && npm install && npm run dev
```

Then open `http://localhost:5173/`. Press DEMO BOSS, or wait for the simulated soil to dry.

**With the ESP32 plugged in over USB** (until the firmware publishes to MQTT by itself),
run the server without `--sim` and add:

```bash
cd server && pip install pyserial && python3 serial_bridge.py
```

It reads the soil lines the ESP32 prints and passes them to the broker.

**Other tools**

| Command | What it does |
| --- | --- |
| `python3 fake_publisher.py` | pretends to be the ESP32: soil A dries until a boss appears. Add `--fast` to hurry it. |
| `python3 test_server.py` | runs the 82 server tests |

## 15. File map

**Server** (`server/`)

| File | What it holds |
| --- | --- |
| `config.py` | every number: thresholds, timings, pump caps, boss stats, the two plants, skills |
| `state_machine.py` | the five modes and what moves the game between them |
| `battle.py` | the turn rules, skills, and the second plant stepping in |
| `rewards.py` | turns a win into a capped pump command, or nothing |
| `engine.py` | joins the pieces: health, stale checks, the state message |
| `main.py` | starts everything and routes messages |
| `mqtt_io.py`, `api.py` | the MQTT and WebSocket connections |
| `creatures.json` | stats for NFC-tagged figures that can stand in for a plant |
| `moisture_sim.py`, `fake_publisher.py`, `serial_bridge.py` | ways to run without full hardware |
| `test_server.py` | tests |

The state machine, battle and reward files have no network code and no clock in them. They
are given the time as a number, which is why they can be tested quickly.

**Game screen** (`client/src/`)

| File | What it holds |
| --- | --- |
| `main.js` | starts the game, the scenes and the server connection |
| `scenes/AdventureScene.js` | the forest walk and the cut to battle |
| `scenes/BossScene.js` | the battle screen |
| `theme/enchantedForest.js` | paints the forest |
| `render/bossEntrance.js` | the boss's arrival |
| `render/bossRig.js`, `data/chomperRig.js` | the moving boss |
| `render/dragonBack.js` | the dragon seen from behind, drawn pixel by pixel |
| `data/bosses.js` | which picture each tier uses |
| `data/plants.js` | the two plants: looks, arm poses, and which action and effect each move uses |
| `data/plantRigs.js` | where each moving piece of the plants sits (made by a script from the pictures) |
| `render/plantRig.js` | a plant built from moving pieces: sway, springs, face, moods, actions |
| `render/petParade.js` | the plants hopping behind the dragon and reacting to a boss |
| `render/battleFx.js` | the effects for each move in the battle |
| `ui/statusBar.js` | the meters and demo button on top of the game |
| `state/wsSource.js` | the connection to the server |

## 16. What is placeholder or not built yet

- **Soil calibration.** `SOIL_RAW_DRY` and `SOIL_RAW_WET` are guesses until the real
  sensors are measured wet and dry.
- **Pump cap.** `PUMP_MAX_MS` is a cautious guess. It must be set at or below the
  firmware's real cap.
- **Battle numbers.** The HP, attack and skill values are placeholders.
- **Sunlight.** The meter is always empty and the grow-light reward is written but never sent.
- **Firmware over MQTT.** The ESP32 does not publish to MQTT by itself yet;
  `serial_bridge.py` fills the gap for soil only. It does not pass on pad (NFC) readings,
  so through the bridge the plants always fight as themselves unless a pad message is
  published by hand.
- **Boss art.** All three tiers share the Drought Chomper picture.
- **Storage screen.** A placeholder.
- **Vision / Jetson.** Not started.
- **Empty files.** `render/battle.js`, `render/boss.js`, `render/walk.js`,
  `render/effects.js`, `state/mockSource.js`, `audio.js` and `assets.js` are stubs with
  nothing in them.
- **Plant art.** Each plant has one picture, seen from the front, in the forest and in the
  battle alike. There is no back view.
