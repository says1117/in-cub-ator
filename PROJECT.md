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
| `incube/debug/boss` | laptop to server | `A` or `B` | force a boss for that plant |

A soil payload that is not a finite number (`inf`, `NaN`, text) is logged and ignored. No
message, from MQTT or the screen, can stop the server.

### WebSocket (server and game screen), port 8765

The server sends the **whole game state** as one JSON message whenever anything changes
(checked five times a second and after every input). The screen sends two kinds of message:

```json
{"action": "demo_boss"}
{"action": "move", "move": "attack", "turn": 3}
```

- `move` is one of `attack`, `guard`, `special`, `skill`.
- `turn` is `battle.turn` of the state the player was looking at. A move for any other turn
  is dropped, so a press meant for one boss sign never lands on the next.
- A move is only played while `battle.accepting_move` is true. There is no queue.
- `"turn": -1` means "I am here, this is not a move": it takes the fight back from the
  autopilot (section 6) without playing anything. Any valid move message does that too.

### The state message (version 2)

```jsonc
{
  "v": 2,
  "mode": "battle",
  "creatures": {"A": "04:A1:B2:C3", "B": null},
  "meters": {"water": {"A": 31.5, "B": 100.0}, "thirsty": {"A": true, "B": false}, "stale": false},
  "fighters": {"A": {"name": "Ember", "skill": "Inferno Bloom"}, "B": {"name": "Zest", "skill": "Sunburst"}},
  "health": 72, "condition": "healthy", "tier": 1,
  "demo_available": false,
  "boss": {"plant": "A", "name": "Drought Chomper", "tier": 1, "hp": 20, "max_hp": 30,
           "type": "drought", "source": "soil"},
  "battle": {
    "id": "b8a1ab", "turn": 2, "plant": "A",
    "team": {"A": {"name": "Ember", "hp": 23, "max_hp": 30, "state": "fighting"},
             "B": {"name": "Zest", "hp": 34, "max_hp": 34, "state": "ready"}},
    "creature": "Ember", "creature_hp": 23, "creature_max_hp": 30, "boss_hp": 20,
    "intent": {"move": "guard", "counter": "special"},
    "blooms": 1, "blooms_max": 3,
    "skill": {"id": "inferno_bloom", "name": "Inferno Bloom", "kind": "damage", "power": 15,
              "ready": true, "ready_in": 0, "recharge": 4},
    "last_move": {"creature": "attack", "boss": "special", "hit": "creature",
                  "dealt": 8, "taken": 0, "healed": 0, "blooms_spent": 0, "bloom_gain": 1, "auto": false},
    "manual": true, "autopilot": false, "accepting_move": true,
    "move_deadline_in_ms": 6000, "over": false
  },
  "result": {"fight": "a3f09c", "outcome": "won", "plant": "A", "water_ms": 2000, "blocked": null},
  "stats": {"fights": 14, "wins": 13, "waterings": 9, "water_ms": 19500}
}
```

- `boss` is set while a boss arrives or a fight is on screen; `battle` is `null` outside a
  fight. After **any** end (won, lost, the boss fled) the finished fight stays for 6 seconds
  with `over: true`, so the screen can play the last blow.
- `battle.id` is new for every fight; with `turn` it tells the screen exactly which turn
  happened, so nothing is played twice or skipped.
- `intent` is the boss's **next** move, always true when shown. `{"move": null}` means it is
  hiding it ("?"). `counter` is the move that beats it.
- `last_move` is the turn just played: who won it (`hit`: `creature`, `boss`, `both`, `tie`
  or `none`), the damage each side took, healing, blooms, and whether the server picked the
  move (`auto`). On a skill turn it carries `skill` (the name); when a plant fainted, `swap`.
- `accepting_move` is honest: true only when a move sent now will be played.
  `move_deadline_in_ms` is how long until the server picks for you. It changes every tick,
  so it is left out when deciding whether to send a new message.
- `result` is the **last finished fight**, and tells the truth about water: `water_ms` is
  the pump time really sent, and `blocked` says why a win gave none (`pump_resting`,
  `soil_wet`, `offline`, `budget`, `publish_failed`).
- `stats` counts today's fights, wins and waterings. It is saved with the pump log.
- `health` is a whole number and only a mood (section 5).
- The boss's hidden choice is never sent, so no screen can read it in advance.

## 3. The game loop: five modes

The server is always in exactly one mode.

```
            soil dry for 5 readings,          5.2 s
            or demo button                    pass
 WALKING ---------------------------> BOSS ----------> BATTLE
    ^                                   |                 |
    |                                   | soil got wet,   | win            lose
    |                                   | or ESP32 lost   v                 |
    |<------------------------------ (boss leaves)     REWARD               |
    |                                                     | 6 s             |
    |              cooldown ends                          v                 |
    +<------------------------------------------------ COOLDOWN <-----------+
```

| Mode | What is happening | How long |
| --- | --- | --- |
| `walking` | The dragon walks. Nothing is wrong. | until the soil dries |
| `boss` | The boss is arriving. The screen plays the entrance. | 5.2 seconds |
| `battle` | Turn-based fight. | until someone hits 0 HP |
| `reward` | You won. The pump runs and the victory panel shows. | 6 seconds |
| `cooldown` | No new boss for this plant. | 60 seconds after the fight (30 in sim mode) |

Rules worth knowing:

- **A boss leaves on its own if the soil gets wet.** If someone waters the plant by hand
  during the arrival or the fight, and the reading rises above 55%, the boss is dismissed
  and the game goes back to walking. This only applies to real soil bosses, not demo ones.
  The fight ends as `dismissed`.
- **Cooldown is per plant**, 60 seconds: the plant that just had a fight cannot call
  another boss until it is over.
- **A breather after every fight.** For 20 seconds after any fight ends, no plant can call
  a boss, not even the other one. The demo button ignores this.
- **If both plants are dry, the drier one goes first.**

(The old rule "a drier plant can skip the cooldown" is gone. Real soil cannot drop a whole
tier inside a minute, so in practice it only ever fired through two bugs, both of which
brought extra bosses and extra pump chances.)

## 4. Soil moisture and boss tiers

The sensor gives a raw number. The server turns it into a percentage: 0% is bone dry,
100% is wet. The two calibration numbers are `SOIL_RAW_DRY` (3000) and `SOIL_RAW_WET`
(1200). They are placeholders until the real sensors are measured.

| Moisture | Tier | Boss | Boss HP | Boss attack | Shows its next move | Water on a win |
| --- | --- | --- | --- | --- | --- | --- |
| 50% and above | 0 | none | | | | |
| under 50% | 1 | Drought Chomper | 30 | 6 | 75% of turns | 2.0 s |
| under 25% | 2 | Parched Brute | 34 | 6 | 65% of turns | 2.5 s |
| 1% or lower | 3 | Desert Dragon | 38 | 7 | 60% of turns | 3.0 s |

A drier plant gets a harder boss and a bigger drink. Every tier must stay winnable, because
winning is the only way the plant gets watered. The rule the numbers were tuned to: **nobody
does worse than in the old game**, whatever they press. Measured over 20,000 seeded fights
per tier (`server/test_balance.py`, which fails if any of this slips):

| Tier | Presses only attack | Presses at random | Nobody playing (autopilot) | Reads the boss (turns) |
| --- | --- | --- | --- | --- |
| 1 | 95.7% | 99.8% | 100% | 100% (4.8) |
| 2 | 94.3% | 99.6% | 99.98% | 100% (5.6) |
| 3 | 88.2% | 98.3% | 99.9% | 100% (6.7) |

A player who reads the boss's sign and counters it wins in well under half the turns of one
who presses at random.

If both plants are dry at once, the **drier one** calls the boss and fights first.

**Two things stop a boss from flickering in and out:**

- A boss only appears after **5 dry readings in a row** (below 50%). One odd reading does
  nothing.
- A boss appears below 50% but only leaves above **55%**. The gap means a reading hovering
  around 50% does not summon and dismiss a boss over and over.

## 5. Plant health

Health is one number from 0 to 100 for the whole cube. It is separate from moisture: it
shows how long the plant has been neglected. **It is a mood only: it never changes a fight.**

- While any plant is dry, health drops: 1% per second at tier 1, 2.5% at tier 2, 5% at tier 3.
- While every plant is fine, health climbs back at 3% per second.
- Winning a fight adds 25 straight away.

| Health | Condition |
| --- | --- |
| 60 and above | healthy |
| under 60 | weary |
| under 30 | wilting |
| 0 | wilted |

(It used to cut a wilted plant's attack to 80%. That punished the thirstiest plant exactly
when it most needed to win its water, so it was removed.)

## 6. The battle

One sentence: **each turn you and the boss both pick attack, guard or special; attack beats
special, special beats guard, guard beats attack; whoever wins the turn hits for their
attack number; a tie does nothing.**

```
   attack  --beats-->  special  --beats-->  guard  --beats-->  attack
```

**Reading the boss is the game.** Before each turn the boss shows what it will do next: a
sign over its head and a pose (it leans in to bite, crouches to guard, flares and gathers
sparks for a special). **A shown sign is always true.** Some turns it hides its move and
shows "?". The button that beats the sign is outlined, so anyone can learn the counter.

- The boss's real pick is made at random, so the boss is no stronger or weaker for showing
  it. Someone who ignores the signs plays exactly the old game.
- **Blooms.** Each turn you win opens a bloom (up to 3). A boss hit wipes them all; a tie
  keeps them. Your **skill** spends every bloom: +50% per bloom, so x2.5 with three. Win a
  few turns by reading the signs, then cash them in, best on a "?" turn, where a skill is
  the safe pick because it always lands.
- The dragon does not fight. It sends in a plant. The plant has HP and an attack number, and
  so does the boss.
- **The thirsty plant goes first**: the one whose dry soil called the boss.
- **If it faints, the other plant steps in**, once, at full HP, with its own skill ready and
  no blooms. The boss keeps whatever HP it had left. The fight is lost only when both plants
  are down.
- Whichever plant lands the last hit, the water goes to the plant that called the boss.

**Timing**

- You have **8 seconds** from the turn to pick (about 5.4 s after the turn has played).
- After each turn there is a **2.6 second** pause before the next move is accepted, so the
  screen can play both moves. A plant fainting adds 1.6 s; a skill that spent blooms adds
  0.3 s per bloom.
- **The autopilot.** If nobody picks in time, the game picks, and from then on plays a turn
  every **3.2 seconds** by itself until anyone presses a key. A kiosk with nobody at it
  shows a lively fight that teaches the game (the autopilot follows the boss's sign some of
  the time) instead of a fight frozen on a timer. Pressing any key takes over ("YOU'RE IN!").
- If **no game screen is connected**, the server plays the fight by itself at the same
  pace. The plant still gets watered if it wins.
- The autopilot only uses what the screen shows. It never heals a plant at full health, and
  it fires the skill to finish the boss or on a "?" turn with blooms to spend.

## 7. The two plants and their skills

The fighters are the two plants themselves (`PLANT_FIGHTERS` in `server/config.py`):

| Plant | Name | Looks like | HP | Attack | Skill |
| --- | --- | --- | --- | --- | --- |
| A | Ember | an anthurium with red flowers | 30 | 8 | Inferno Bloom |
| B | Zest | a striped lemon-lime dracaena | 34 | 7 | Sunburst |

Each plant pad can also hold an NFC-tagged figure. A tag listed in `server/creatures.json`
replaces that plant's name and numbers for the fight. A tag that is not in the file, or an
empty pad, leaves the plant as it is.

| Figure | HP | Attack | Skill |
| --- | --- | --- | --- |
| Thornback | 30 | 8 | Thorn Burst |
| Mossling | 36 | 6 | Photosynthesis |
| Barkhorn | 32 | 7 | Bark Shield |

A skill **always works**, whatever the boss picked, and is made bigger by the blooms it
spends (section 6). After you use it, it needs **4 turns** to recharge. Pressing skill
while it is recharging counts as a plain attack.

| Skill | What it does | Can the boss still hit you that turn? |
| --- | --- | --- |
| Inferno Bloom (Ember) | hits for 1.25 times your attack | yes, if the boss picked attack |
| Sunburst (Zest) | heals 8 HP and hits for half your attack | yes, if the boss picked attack |
| Thorn Burst | hits for your full attack | yes, if the boss picked attack |
| Photosynthesis | heals 8 HP (never above your maximum) | yes, if the boss picked attack |
| Bark Shield | blocks everything and bounces back half your attack | no |

**What the moves are called and look like**

The rules only know attack, guard, special and skill. Each fighter does them its own way:

| | Attack | Guard | Special | Skill |
| --- | --- | --- | --- | --- |
| Ember | Vine Haymaker: runs in and lands a burning fist | Petal Aegis: a wheel of red petals; if it holds they fly back | Flamingo Flare: burning petals corkscrew across | Inferno Bloom: a flower of fire opens under the boss and a pillar comes up |
| Zest | Blade Rush: darts in and cuts three times | Stripe Wall: striped blades stab up as a fence; if it holds they launch | Citrus Volt: a ball of lightning jumps to the boss | Sunburst: a small sun heals Zest, then spears the boss |
| Boss | a pair of huge jaws snaps shut | it slams the ground: a crack races over and roots spike up | a ball of heat builds in its mouth, then a beam | none |

The three boss tiers share these moves under their own names and colours (`BOSS_MOVES` and
`BOSS_PALETTES` in `client/src/data/bosses.js`): red heat for the Chomper, sand and gold
for the Brute, cold violet fire for the Dragon.

Both sides always show their move, even the one that lost the turn. The plant goes first
and the boss answers. If the plant's guard is what won, the boss strikes first and breaks
on the shield. A tie has both go at once and meet in the middle. A final blow gets no
answer.

**Adding a skill or a move later** takes three small steps, and the first is the only one
that changes the rules:

1. The rule: add the skill to `SKILLS` in `server/config.py` and give it to a plant in
   `PLANT_FIGHTERS`. `battle.py` already understands `damage_factor`, `heal` and `block`
   (a skill may have both `damage_factor` and `heal`, like Sunburst). Run
   `python3 test_balance.py` afterwards: a stronger skill only helps, a weaker one may not.
2. The body: how the plant moves is an "action" in `client/src/render/plantRig.js` (strike,
   rush, guard, cast, channel, hurt, hop, cheer and so on). An action is one small function that turns a few
   dials (lift, lean, stretch, arms open, a named arm pose). The notes at the top of that
   file explain how to add one.
3. The effect: what flies across the screen is a function in `client/src/render/battleFx.js`,
   built from the paint box in `client/src/render/fxKit.js` (sparks, beams, lightning,
   slashes, shockwaves, screen flashes). `client/src/data/plants.js` gives each move and
   skill its name, its action, its effect and the picture on its button, per plant.

## 8. Rewards and pump safety

Winning sends one pump command: `incube/cmd/pump/A` with a time in milliseconds. The server
checks, in this order, and sends nothing if any check fails (the reason goes to
`result.blocked`, and the screen says it in words):

1. **The sensor is alive** (`offline`). A reading from *that plant's* sensor must have
   arrived in the last 30 seconds, and the ESP32 must not be marked offline. Before the first
   reading after a start, nothing is ever pumped.
2. **The soil is not already wet** (`soil_wet`). At 55% or above, no water. A demo boss on
   wet soil gets only a **0.5 s sip**, so the pump still runs on stage.
3. **Not watered moments ago** (`pump_resting`). The last pump for this plant was at least
   60 seconds ago.
4. **The hourly budget** (`budget`). All pump time for this plant in the last hour, plus this
   command, stays within **12 seconds**. A soil probe pulled out of the pot reads bone dry
   forever; this keeps that to a few short drinks an hour instead of one every minute.
5. **The cap.** No pump command is ever longer than `PUMP_MAX_MS` (3000 ms), whatever the
   tier table says.

More safety:

- **Every pump is logged** to `server/var/pump_log.json` (wall-clock time, written safely,
  git-ignored), so the 60 s gap and the hourly budget survive a restart. A damaged log file
  counts as a full pump just now for both plants: the safe side.
- **A pump only counts if it went out.** Commands use QoS 0 and are never retained. If the
  broker refuses one, it is rolled back and the result says `publish_failed`. (QoS 1 was
  ruled out on purpose: the MQTT library re-sends a failed QoS 1 message later, which would
  be an unbudgeted pump.)
- **Simulations never touch the real log.** `--sim` and `--offline` keep the log in memory
  unless `--state=PATH` is given.

The firmware has its own hard cap as well. The server's cap must never be higher than the
firmware's. Losing sends nothing.

## 9. What happens when the hardware goes quiet

The readings are marked **stale** when either:

- the ESP32 publishes anything other than `online` on its status topic, or
- no soil reading has arrived for **30 seconds**.

When that happens:

- a boss that is arriving, or a fight in progress, is dropped (the fight ends as
  `dismissed`) and the game goes back to walking;
- no pump command is sent, even for a fight that was just won;
- the dry-reading counts start again, so a sensor coming back needs 5 fresh dry readings
  before a boss can appear;
- the state message carries `meters.stale: true`, and the screen shows "ESP32 offline" and
  greys out the plants' water tags.

The moment any soil reading arrives again, the readings count as fresh.

## 10. The demo button

**Summon boss [D]** at the top right of the forest (or the D key) summons a boss without
waiting for dry soil. It is for showing the project on stage.

- It picks the plant that has a creature on its pad. If both or neither has one, it picks
  the plant with less water.
- The boss's tier follows that plant's real moisture, with tier 1 as the minimum.
- It only shows, and only works, while walking or resting (`demo_available`), and never
  while a finished fight is still on screen.
- After the boss appears, everything is the normal flow. A win on wet soil gives the 0.5 s
  sip; the gap, the hourly budget and the cap all still apply.

A laptop can do the same by publishing `A` or `B` to `incube/debug/boss`.

## 11. The game screen

The screen is a Phaser 4 game, 800 by 450, drawn in code with a few picture files. It has
three scenes and one font (Tiny5, bundled with the page so the kiosk needs no network).

| Scene | What it is |
| --- | --- |
| `AdventureScene` | The forest walk. The dragon walks forever through a painted enchanted forest: wisteria, glowing runes, crystals, mushrooms, a lily pond. The two plants hop along behind it. |
| `BossScene` | The battle screen, in the style of a monster-battle game, set in the same enchanted forest where the boss landed: the fighting plant at the front left, the boss at the back right, the dragon and the other plant waiting behind. |
| `HudScene` | Always on top. What a passer-by reads in the forest (below). |

Every address opens the forest; if a fight is on, it cuts straight to the battle.

**On top of the forest** (`HudScene`, hidden during the boss and the fight):

- a tag over each plant: its name, a water droplet and its moisture in %; orange when it is
  thirsty, grey "?" when the sensors are offline;
- today's count at the top left: "Watered 9x today · 19.5 s of water";
- **Summon boss [D]** at the top right (section 10);
- a caption along the bottom: while walking it explains the game ("These plants are REAL",
  "Dry soil summons a boss", "Win the fight: the real pump waters the plant"); after a fight
  it says what really happened ("Zest won: the real pump gave it 2 s of water", or why there
  was no water);
- "reconnecting…" or "ESP32 offline" at the top when something is wrong, and a mute button
  (M also mutes).

**The two plants in the forest**

- They follow the dragon and hop **in turns**: one is never in the air while the other is.
- Each is built from moving pieces: its arms and loose leaves sway on their own, its leaves
  bend like grass, it breathes and blinks. Everything loose is on a spring, so arms and
  leaves trail behind a hop and wobble when it lands.
- A thirsty plant droops, hops lower and slower, and sweats now and then.
- When a boss is spotted they both jump in fright. The landing blows them back. Then the
  dragon calls the thirsty one ("GO, EMBER!"), which bounds to the front with an angry
  face, while the other one hides behind the dragon and shakes.
- After a win they bounce and beam while the reward is on screen.

**The battle screen**

- The backdrop is painted from the forest's own layers, seen closer up, once per page load.
- Plates: who is thirsty and both plants' health at the top left, the boss at the top
  right, the fighting plant with its HP, soil and **blooms** at the bottom left, and a line
  saying what just happened. The four move buttons (keys 1 to 4) show the plant's own move
  names, the icon each one beats, and the skill's power.
- The boss's sign floats beside its head, and the button that beats it is outlined.
- **Each turn plays in beats:** the hidden sign turns over (or the shown one pulses) and the
  plant's pick pops up; who beat whom is shown in icons; then the exchange from section 7,
  with each move called out by name. Blows land with a short freeze (hit-stop), a flash,
  shake and a damage number, and **health bars only move when a blow lands**. Then the
  next sign appears.
- Pressing a move stamps "LOCKED IN" on it. Buttons only work while the server will accept
  a move and the last turn has finished playing. A timer bar runs above them and turns red
  for the last three seconds. During the autopilot a ribbon says "AUTO · press 1–4 to take
  over".
- The final blow always plays first. Then **VICTORY** with what really happened: "Ember is
  drinking · Pump A · 2.0 s of real water" and a filling bar, or an honest reason when there
  was no water; or **DEFEAT** ("still thirsty, the boss will be back soon"); or "the boss
  fled". Then the forest comes back.
- If the screen falls behind or reloads mid-fight it catches up to the server's state; if
  the fight vanishes (the server restarted), it ends it as "the boss fled".

**Sound** is made in the browser (`client/src/audio/`, no sound files): a sound for every
press, reveal, clash, blow, bloom, skill, faint and boss move, forest ambience, a boss sting,
battle music that grows tense near the end, and victory and defeat jingles. The kiosk
browser is started with autoplay allowed. During the autopilot it is quieter.

**How the screen follows the server**

- Every state message is stored where any scene can read it (`registry.get("serverState")`).
- `AdventureScene` watches the mode. When it becomes `boss`, it plays the entrance. When the
  entrance is finished and the mode is `battle`, it cuts to `BossScene`. If the entrance
  falls behind (a slow machine), the battle opens 2.5 s into the fight anyway.
- If the mode leaves `boss` before the fight (the soil got wet, or the ESP32 dropped), the
  entrance is cancelled and everything it moved is put back.
- `BossScene` turns the messages into events (`state/battleTurns.js`): a new fight, one
  turn, a catch-up, the result. They play one after another from a queue.

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
7. **Cut.** One soft flash (none with reduced motion or `?calm`), a fade, and the battle
   screen opens.

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

It roars once when it lands in the forest. In battle it also takes a pose for the move it
is about to make (see section 6), and its attacks are drawn by `client/src/render/bossFx.js`.

While it is in the air during the entrance it is the flat picture; it switches to the
moving version at the start of the roar.

**Adding a new boss picture:** put the file in `client/public/assets/bosses/` and change
that tier's line in `client/src/data/bosses.js`. A boss without layers works too: it just
does not sway or open its mouth.

## 14. Running it

You need Python 3 and Node. Mosquitto is only needed with real hardware.

**Without any hardware, in one go** (no broker at all: an in-process stand-in replaces it,
and the soil is made up):

```bash
cd server && pip install -r requirements.txt && python3 main.py --offline
```

```bash
cd client && npm install && npm run dev
```

Then open `http://localhost:5173/`. Press **D** (or the Summon boss button), or wait for the
simulated soil to dry. The made-up soil behaves like a pot: it only dries, slowly (50 points
takes two to three minutes), and only a pump command makes it wetter. A watering leaves it at
80% or more and it holds that for 20 seconds before drying again. Plant A starts drier than
plant B, so the first boss comes after about half a minute. In this mode the per-plant
cooldown and pump gap are 30 seconds.

`--sim` is the same made-up soil, but through a real Mosquitto broker (`brew install
mosquitto`, then run `mosquitto`). Other options: `--ws-port=N`, `--seed=N` (repeatable
runs), `--state=PATH` (where the pump log goes). `?ws=PORT` or `?ws=host:port` in the page
address points the screen at another server.

**With the ESP32 plugged in over USB** (until the firmware publishes to MQTT by itself),
run `mosquitto`, the server without `--sim`, and:

```bash
cd server && pip install pyserial && python3 serial_bridge.py
```

It reads the soil lines the ESP32 prints and passes them to the broker.

**On the Jetson**, `server/deploy/setup_jetson.sh` installs the broker settings and the
services; `kiosk.sh` opens the game full-screen with sound allowed.

**Checking that it works**

| Command | What it does |
| --- | --- |
| `cd server && python3 test_server.py` | all 161 server tests: rules, pump safety, the state message, balance |
| `cd server && python3 test_balance.py` | prints the win-rate table of section 4 |
| `cd client && npm test` | the client's turn logic |
| `cd client && npm run build && NODE_PATH=$(npm root -g) npm run e2e` | plays two real fights in a headless browser against `--offline` and checks that no press is lost, the last blow plays before the result, the water shown matches the pump command and the forest comes back. Needs Playwright installed globally. Screenshots in `client/e2e-out/`. |
| `python3 fake_publisher.py` | pretends to be the ESP32: soil A dries until a boss appears. Add `--fast` to hurry it. |

## 15. File map

**Server** (`server/`)

| File | What it holds |
| --- | --- |
| `config.py` | every number: thresholds, timings, pump caps and budget, boss stats, the two plants, skills |
| `state_machine.py` | the five modes and what moves the game between them |
| `battle.py` | the turn rules: boss signs, blooms, skills, the second plant stepping in, the autopilot's choice |
| `rewards.py` | turns a win into a capped pump command, or the reason there is none |
| `engine.py` | joins the pieces: fights, health, stale checks, the autopilot's pace, stats, the state message |
| `protocol.py` | reading the screen's messages, and which keys of the state are clock-only |
| `persist.py` | the pump log and today's stats on disk (the only file the server writes) |
| `main.py` | starts everything and routes messages; never stops on a bad one |
| `mqtt_io.py`, `api.py` | the MQTT connection (or the offline stand-in) and the WebSocket |
| `creatures.json` | stats for NFC-tagged figures that can stand in for a plant |
| `moisture_sim.py`, `fake_publisher.py`, `serial_bridge.py` | ways to run without full hardware |
| `test_server.py`, `test_contract.py`, `test_balance.py` | tests (`test_server.py` runs all three) |

The state machine, battle and reward files have no network code and no clock in them. They
are given the time as a number, which is why they can be tested quickly.

**Game screen** (`client/src/`)

| File | What it holds |
| --- | --- |
| `main.js` | starts the game, the scenes, the sound and the server connection |
| `scenes/AdventureScene.js` | the forest walk and the cut to battle |
| `scenes/BossScene.js` | the battle screen: the event queue and how each turn is told |
| `scenes/HudScene.js`, `ui/hudText.js`, `ui/hudArt.js` | what is written over the forest |
| `battle/hud.js` | everything written on the battle screen: plates, bars, buttons, the boss's sign, blooms, timer, banners, the result |
| `battle/arena.js` | the battle backdrop, painted from the forest's layers |
| `battle/icons.js` | the little pixel icons for the moves, "?" and blooms |
| `state/battleTurns.js` | turns two server messages into what to play (tested by `npm test`) |
| `state/wsSource.js` | the connection to the server |
| `audio/` | all sound, made in the browser |
| `ui/font.js` | the one font and its text style |
| `theme/enchantedForest.js` | paints the forest |
| `render/bossEntrance.js` | the boss's arrival |
| `render/bossRig.js`, `render/bossTellFx.js`, `data/chomperRig.js` | the moving boss and the poses for its next move |
| `render/dragonBack.js` | the dragon seen from behind, drawn pixel by pixel |
| `data/bosses.js` | which picture each tier uses, what it calls its moves, and its colours |
| `data/plants.js` | the two plants: looks, arm poses, and the name, action and effect of each move |
| `data/plantRigs.js` | where each moving piece of the plants sits (made by a script from the pictures) |
| `render/plantRig.js` | a plant built from moving pieces: sway, springs, face, moods, actions |
| `render/petParade.js` | the plants hopping behind the dragon and reacting to a boss |
| `render/fxKit.js` | the paint box for effects: sparks, beams, lightning, slashes, shockwaves |
| `render/battleFx.js` | what each plant move looks like |
| `render/bossFx.js` | what each boss move looks like |

`client/scripts/e2e.mjs` is the headless fight check; `client/test/` holds the unit tests.

## 16. What is placeholder or not built yet

- **Soil calibration.** `SOIL_RAW_DRY` and `SOIL_RAW_WET` are guesses until the real
  sensors are measured wet and dry.
- **Pump cap and budget.** `PUMP_MAX_MS` and `PUMP_BUDGET_MS_PER_HOUR` are cautious guesses.
  The cap must be set at or below the firmware's real cap.
- **Grow light.** The hardware has one, but the game has no sunlight meter and never switches it on.
- **Firmware over MQTT.** The ESP32 does not publish to MQTT by itself yet;
  `serial_bridge.py` fills the gap for soil only. It does not pass on pad (NFC) readings,
  so through the bridge the plants always fight as themselves unless a pad message is
  published by hand.
- **Broker access.** The broker accepts anyone on the network. Anyone there could publish a
  pump command directly, so the firmware's own cap is the real last line of defence.
- **Boss art.** All three tiers share the Drought Chomper picture.
- **Vision.** Not started.
- **Plant art.** Each plant has one picture, seen from the front, in the forest and in the
  battle alike. There is no back view.
- **Start-up time.** Painting the forest takes several seconds in a software-rendered
  browser; it should be measured on the Jetson.
- **Entrance flashes.** The impact frames still flash white and inverted; a softer version
  for public screens is planned.

