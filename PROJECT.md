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
| `incube/pad/A`, `incube/pad/B` | ESP32 to server | an NFC tag ID, or empty when lifted | whether a plant is on the cube, and which figure it is |
| `incube/status/esp32` | ESP32 to server | `online` or anything else | is the ESP32 alive |
| `incube/cmd/pump/A`, `incube/cmd/pump/B` | server to ESP32 | milliseconds, e.g. `2000` | run this pump for this long |
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
  "meters": {"water": {"A": 31.5, "B": 100.0}, "stale": false},
  "fighters": {"A": {"name": "Ember", "skill": "Inferno Bloom"}, "B": {"name": "Zest", "skill": "Sunburst"}},
  "health": 72.4,
  "condition": "healthy",
  "tier": 1,
  "boss": {"plant": "A", "name": "Drought Chomper", "kind": "chomper", "tier": 1, "hp": 30, "max_hp": 38,
           "type": "drought", "source": "soil"},
  "battle": {"turn": 2, "plant": "A",
             "team": {"A": {"name": "Ember", "hp": 23, "max_hp": 30, "state": "fighting"},
                      "B": {"name": "Zest", "hp": 34, "max_hp": 34, "state": "ready"}},
             "creature": "Ember", "creature_hp": 23, "creature_max_hp": 30,
             "boss_hp": 30,
             "last_move": {"creature": "attack", "boss": "special", "shown": "special", "bluffed": false,
                           "heavy": false, "hit": "creature", "damage": 8, "took": 0},
             "intent": {"move": "attack", "grade": "likely", "chance": 0.75, "bluff": "special", "heavy": false},
             "enraged": false, "enrage_hp": 19, "hints": true,
             "skill": {"name": "Inferno Bloom", "ready": true, "charge": 2, "need": 2},
             "manual": true, "awaiting_move": true, "move_seconds_left": 8},
  "reward": {"type": "water", "plant": "A", "size": 2000, "tier": 1}
}
```

- `boss` and `battle` are `null` when there is none.
- `battle.plant` is the plant fighting right now. `battle.team` lists both plants: `fighting`,
  `ready` (waiting on the bench) or `down` (fainted). `creature`, `creature_hp` and `skill`
  always describe the one that is fighting.
- `battle.intent` is the boss's **tell** for the coming turn: the move it shows, how sure
  that is (`grade` is `sure`, `likely` or `flip`, and `chance` is the number), the move it
  will use instead if this is a bluff, and whether it is a heavy hit. The move it will
  really use never leaves the server.
- `battle.last_move` says what happened last turn: both moves, the move the boss had shown,
  whether that was a bluff, who was hit (`creature`, `boss`, `both`, `tie` or `none`), the
  damage dealt and the damage taken. The turn the boss drops to half health it also carries
  `"enraged": true`.
- `battle.hints` is true on tier 1: the move cards may say outright how they do against the tell.
- When a plant faints and the other steps in, that turn's `last_move` also carries
  `"swap": {"out": "A", "in": "B", "name": "Zest"}`.
- After a **lost** fight, `boss` and `battle` stay in the message for 6 seconds (the mode is
  already `cooldown`) so the screen can play the last blow.
- `reward` is the reward for the fight just won, or `null` if no pump command was sent. It
  is cleared when the next fight starts.
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
| `reward` | You won. The pump runs and the victory panel shows. | 6 seconds |
| `cooldown` | No new boss for this plant. | 60 seconds after the fight (15 in sim mode) |

Rules worth knowing:

- **A boss leaves on its own if the soil gets wet.** If someone waters the plant by hand
  during the arrival or the fight, and the reading rises above 55%, the boss is dismissed
  and the game goes back to walking. This only applies to real soil bosses, not demo ones.
- **Cooldown is per plant**, 60 seconds: the plant that just had a fight cannot call
  another boss until it is over.
- **A breather after every fight.** For 20 seconds after any fight ends, no plant can call
  a boss, not even the other one. The demo button ignores this.
- **A drier plant can skip the cooldown.** If the soil has dropped into a harder tier than
  the last boss, a new boss comes once the breather is over.
- **If both plants are dry, the drier one goes first.**

## 4. Soil moisture and boss tiers

The sensor gives a raw number. The server turns it into a percentage: 0% is bone dry,
100% is wet. The two calibration numbers are `SOIL_RAW_DRY` (3000) and `SOIL_RAW_WET`
(1200). They are placeholders until the real sensors are measured.

| Moisture | Tier | Boss HP | Boss attack | Water on a win |
| --- | --- | --- | --- | --- |
| 50% and above | 0 | no boss | | |
| under 50% | 1 | 38 | 9 | 2.0 s |
| under 25% | 2 | 44 | 11 | 2.5 s |
| 1% or lower | 3 | 48 | 13 | 3.0 s |

**Which boss comes is a separate roll.** Each time a boss is called, the game picks one of two
at random, **50% each**, whatever the soil says: the **Drought Chomper** or the **Sporeling Trio**
(`BOSS_KINDS` in `server/config.py`). The tier only sets how strong it is. The pick is kept for
the whole fight and sent to the screen as `boss.kind`.

A drier plant gets a harder boss and a bigger drink. Every tier is meant to stay winnable,
because winning is the only way the plant gets watered. Section 6 has the win rates.

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
- Health holds still while a boss is arriving, being fought, or has just been beaten.
- While every plant is fine, health climbs back at 3% per second.
- Winning a fight adds 25 straight away.

| Health | Condition shown | Effect |
| --- | --- | --- |
| 60 and above | healthy | a fight starts with the skill half charged |
| under 60 | weary | a fight starts with the skill empty |
| under 30 | wilting | the same |
| 0 | wilted | the same, and both plants' attack is cut to 80% |

A wilted plant can still fight and still win, and a win waters it. There is always a way back.

## 6. The battle

One sentence: **the boss shows the move it is winding up and how sure that is; beat it to
hit and charge your skill, or copy it to stay safe when it may be a bluff.**

```
   attack  --beats-->  special  --beats-->  guard  --beats-->  attack
```

Each turn you and the boss both use attack, guard or special.

- **You win the turn:** you hit for your attack number, and your skill gains one charge.
- **You lose the turn:** the boss hits you for its attack number.
- **A tie:** the two moves clash and your plant is grazed for half a boss hit, rounded down.

**The tell.** Before you pick, the boss shows a move and a grade:

| Grade | Chance the shown move is real | If it is not |
| --- | --- | --- |
| SURE | 100% | |
| LIKELY | 75% | it uses the bluff move, which is shown too |
| COIN FLIP | 50% | the same |

The bluff move is always the one that beats the obvious answer: it shows attack, you guard,
it uses special. A bluff that lands hits 1.5 times as hard. So against a coin flip, copying
the shown move is the safe play: a graze if it was real, a hit for you if it was the bluff.

**What makes the three tiers different** (either boss can be any tier)

| Tier | Calm tells | Enraged tells | Its own trick |
| --- | --- | --- | --- |
| 1 mild | always SURE | 70% LIKELY, 30% COIN FLIP | the move cards say WINS, CLASH or LOSES |
| 2 dry | always LIKELY | half LIKELY, half COIN FLIP | every third turn is a HEAVY wind-up: SURE, and it hits double |
| 3 bone dry | half LIKELY, half COIN FLIP | 25% LIKELY, 75% COIN FLIP | heavy wind-ups too, and once enraged they can be bluffs |

- **Enraged:** at half health the boss roars. From the next turn it hits harder (+2, +2, +3)
  and its tells get shakier, as in the table.
- **It notices a repeated move:** use the same plain move twice running and the boss will
  probably show the move that beats it (50%, 75%, 90% by tier).
- No single boss hit takes more than 24, so one mistake never ends a fight.

**The team**

- The dragon does not fight. It sends in a plant. **The thirsty plant goes first**: the one
  whose dry soil called the boss.
- **If it faints, the other plant steps in**, once, at full HP and with its skill charged.
  The boss keeps whatever HP it had left. The fight is lost only when both plants are down.
- Whichever plant lands the last hit, the water goes to the plant that called the boss.
- Your fourth button is the fighting plant's **skill** (next section).

**How winnable it is** (measured by `BalanceTests`, thousands of fights each)

| Player | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Answers every tell (this is also what the game plays by itself) | 97% | 97% | 81% |
| Random buttons | 66% | 35% | 25% |
| One key held down, or always copying the boss | under 50% | under 20% | under 20% |

**Timing**

- You have **10 seconds** to pick. If you do not, the game picks for you: it answers the
  tell, and uses a charged skill unless the boss shows an attack. A fight can never hang.
- After each turn there is a 4.8 second pause before the next move is accepted, so the
  screen has time to play both moves. A turn where a plant faints adds 1.6 seconds, and the
  turn the boss becomes enraged adds 1.
- If **no game screen is connected**, the server plays the whole fight by itself, one turn
  every 4.8 seconds. The plant still gets watered if it wins.

## 7. The two plants and their skills

The fighters are the two plants themselves (`PLANT_FIGHTERS` in `server/config.py`):

| Plant | Name | Looks like | HP | Attack | Skill |
| --- | --- | --- | --- | --- | --- |
| A | Ember | an anthurium with red flowers | 30 | 8 | Inferno Bloom |
| B | Zest | a striped lemon-lime dracaena | 34 | 7 | Sunburst |

**A plant is only in the game while its pad reads a tag** (the NFC chip on its pot, `config.PLANTS_NEED_PADS`).
Lift it and it is gone: it has no moisture meter, it cannot call a boss, it takes no part in a fight and
it is never watered. Set it back down and it returns. A plant that is lifted while it is calling a boss
(or fighting) sends the boss away with no reward; a lifted bench plant just leaves the fight. With no
plant on the cube there is no boss at all, the demo button does nothing and the status panel is empty.
The state message has `present` (`{"A": true, "B": false}`) and `meters.water` is `null` for a plant that
is not there. On screen the plants follow the dragon only while present, and poof away and back
(`render/petParade.js`). With `--sim` both plants start on the cube, and the screen shows "Lift Ember" and
"Lift Zest" buttons that stand in for the pads. Set `PLANTS_NEED_PADS = False` for a cube whose pads
are not wired up: both plants then always count.

An NFC-tagged figure on a pad counts as a plant too. A tag listed in `server/creatures.json`
replaces that plant's name and numbers for the fight. A tag that is not in the file leaves the
plant as it is.

| Figure | HP | Attack | Skill |
| --- | --- | --- | --- |
| Thornback | 30 | 8 | Thorn Burst |
| Mossling | 36 | 6 | Photosynthesis |
| Barkhorn | 32 | 7 | Bark Shield |

A skill **always works**, whatever the boss does. It needs **2 charges**, and every turn won
with a plain move adds one. A fight starts with 1 charge (0 if health is under 60). The plant
that steps in from the bench arrives fully charged. Using the skill empties it. Pressing
skill before it is charged counts as a plain attack.

| Skill | What it does | Can the boss still hit you that turn? |
| --- | --- | --- |
| Inferno Bloom (Ember) | hits for 1.75 times your attack (14) | yes, if the boss picked attack |
| Sunburst (Zest) | heals 8 HP and hits for 0.75 times your attack (5) | yes, if the boss picked attack |
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

Both bosses use these three moves under their own names and colours (`BOSS_MOVES` and
`BOSS_PALETTES` in `client/src/data/bosses.js`): red heat for the Chomper (Chomp, Scorch Ray,
Thorn Quake) and pink spores for the Sporeling Trio (Spore Gnash, Spore Cannon, Mycelium Quake).

The **Sporeling Trio** is three sad mushrooms on one patch of ground, a flat picture
(`client/public/assets/bosses/sporelings.png`) with no moving pieces. Where the Chomper opens
its mouth to roar, the Trio rears up and shakes. Its attacks come from the left-hand mushroom's
mouth (`mouth` in `bosses.js`).

Both sides always show their move, even the one that lost the turn, and the turn is told
line by line. "EMBER USED VINE HAYMAKER!" types out, a beat passes, the move plays, and a
word says how it went (DIRECT HIT!, BOOM!, CRITICAL HIT!, KNOCKOUT!, IT FAILED!). After a
pause the boss gets its line, its move and its word (OUCH!, CRUNCH!, HEAVY HIT!, NO
EFFECT!, and BLUFF! when the tell was a lie). If the plant's guard is what won, the boss
strikes first and breaks on the shield (BLOCKED!). A tie has both go at once and meet in
the middle (CLASH!). CRITICAL HIT is a label for a hit of 9 or more, not a rule.

**Adding a skill or a move later** takes three small steps, and the first is the only one
that changes the rules:

1. The rule: add the skill to `SKILLS` in `server/config.py` and give it to a plant in
   `PLANT_FIGHTERS`. `battle.py` already understands `damage_factor`, `heal` and `block`.
   The tagged figures' skills keep their old strength and were not rebalanced for the tells.
2. The body: how the plant moves is an "action" in `client/src/render/plantRig.js` (strike,
   rush, guard, cast, channel, hurt, hop, cheer and so on). An action is one small function that turns a few
   dials (lift, lean, stretch, arms open, a named arm pose). The notes at the top of that
   file explain how to add one.
3. The effect: what flies across the screen is a function in `client/src/render/battleFx.js`,
   built from the paint box in `client/src/render/fxKit.js` (sparks, beams, lightning,
   slashes, shockwaves, screen flashes). `client/src/data/plants.js` gives each move and
   skill its name, its action, its effect and the picture on its button, per plant.

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
- no soil reading has arrived for **30 seconds**. Only soil readings count: a repeated
  `online` message cannot hide sensors that have stopped.

When that happens:

- a boss that is arriving, or a fight in progress, is dropped and the game goes back to walking;
- no pump command is sent, even for a fight that was just won;
- the state message carries `meters.stale: true` so the screen can say so.

The moment any soil reading arrives again, the readings count as fresh.

Before the ESP32 has been heard from at all (a server just started with no hardware), the
game is fully playable but **no pump command is sent**, even for a won demo fight.

## 10. The demo button

The **DEMO BOSS** button on the game screen summons a boss without waiting for dry
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

**On top of the forest** sits an overlay in the same pixel style as the battle screen
(`ui/statusBar.js`): a water bar for each plant with a mark at the 50% line, the vigor
(health) bar, a note when the cube is weary or offline, a "BOSS ALERT" banner, a line that
says what is going on, the connection status, the demo button and the sound switch. If the
game server cannot be reached it says so in the middle of the screen.

**Sound** (`audio.js`) is made in code: there are no sound files. Voices are built from
detuned stacks, FM bells, filter sweeps, distortion and noise, with a shared reverb, a drum
kit and a gentle limiter. Two songs play (below) and every event has a sound of its own. The
M key or the SOUND button turns it all off. A browser only allows sound after the first key
press or click; for a kiosk start Chromium with `--autoplay-policy=no-user-gesture-required`.
On the dev server, `/sounds.html` lists every sound and both songs to click and hear.

How each event sounds, what else was considered, and why this one won. The choice is fixed:
the same event always gets the same sound.

| Event | What is happening | Considered | Chosen |
| --- | --- | --- | --- |
| Forest walk | calm, nothing to do but watch | a loop of wind only; a slow solo piano; a pad with a plucked arpeggio and a tune | **Forest song**: D major, 72 bpm, warm pad, harp arpeggio, a flute tune, birds, wind. It has a story over 8 bars and never fights the alarm. |
| Boss alert | dry soil called a boss | a plain beep; a rising horn; a two-tone siren | **Siren and low swell**: four siren pulses, then a deep swell, so it feels like something is coming |
| Boss far off | it bounds once, far away | silence; a distant drum | **Small thump** with dust |
| Tree breaks | it knocks a tree down | a single crash | **Crack, creak, crash** in three parts |
| Boss lands | big impact, the ground jumps | a short boom; a boom with a falling sine; a layered impact | **Layered impact**: sub-bass drop, noise crash, rumble, and the music ducks |
| Boss roars | it roars at the dragon | a growl sample (not allowed); noise only; a distorted saw with a flutter, plus voice-like noise bands | **Distorted saw growl** with two moving noise bands |
| Cut to fight | two flashes, then the fight screen | a whoosh; a hit and a riser | **Two sharp hits then a riser** |
| Fight starts | the battle screen opens | straight into the song; a drum hit; a sting then the song | **Sting** (kick, cymbal, minor chord, toms), then the **Battle song** fades in half a second later |
| Battle song | the whole fight | four-on-the-floor dance; slow dark ambient; driving rock with a hook | **Battle song**: A minor, 138 bpm, kick and snare, pumping saw bass, fast arpeggio, a lead hook. It builds over 8 bars and rolls into the loop. |
| Boss wind-up shown | the tell appears | one beep for all; a different sound per grade | **A different sound per grade**: SURE a clear fifth, LIKELY a minor third left hanging, COIN FLIP a spinning coin. You can hear how sure it is. |
| Heavy wind-up | a double-damage hit is coming | a drum roll; a low warning tone; a heartbeat with a rising growl | **Heartbeat and a rising growl** |
| Pick a move | you choose a card | a click; a blip; a two-note bell | **Two-note bell**; a dull buzz if the skill is not ready |
| Line typing out | "EMBER USED ..." types in | silence; a typewriter; a quiet tick | **Quiet tick** in three pitches, so it does not drone |
| Ember attack, Haymaker | a burning fist | a plain whoosh; whoosh plus flame | **Wind-up whoosh and a flame roar** |
| Ember guard, Aegis | a wheel of petals | a clang; a chime; a shimmering bell chord | **Shimmering bell chord** |
| Ember special, Flare | burning petals corkscrew | a laser; a rising saw; a rising saw with crackle | **Rising saw with a wobble and crackle** |
| Ember skill, Inferno Bloom | a long charge, then a pillar of fire | a boom; a riser then a boom; riser, boom, and sparkles | **Riser, eruption, sparkle shower** |
| Zest attack, Blade Rush | three quick cuts | one slash; three slashes | **Three metallic slashes**, left to right |
| Zest guard, Stripe Wall | blades stab up as a fence | one thud; a stab per blade | **Four rising plucked stabs** |
| Zest special, Citrus Volt | a ball of lightning | white noise; a buzz; random zaps with a hum | **Random zaps over a buzzing hum** |
| Zest skill, Sunburst | a small sun, heals | a harp; a warm chord; a swelling chord then sparkles | **Swelling major chord, then sparkles** |
| Boss bite | huge jaws | a growl; a snap; a growl, then a snap and a thud | **Growl, then the jaws shut** with a thud, in time with the picture |
| Boss ray | a beam, aimed first | a laser; a charge hum then a beam | **Rising charge, then a roaring beam** |
| Boss quake | roots spike up | a rumble; rumble, crack, snaps | **Rumble, crack, then roots snapping up** |
| Plant lands a hit | damage to the boss | a thud; a thud and a slap; a layered punch | **Layered punch** (noise, sub thump, a crack), slightly different each time |
| Big hit, or the last blow | 9 damage or more, or a knockout | the same, louder; a bigger layered hit | **Bigger layered hit** with a bell shimmer; the music ducks |
| Plant is hurt | damage to the plant | the same as a hit; a thud and a short cry | **Thud and a short falling cry** |
| Tie graze | a small hit in a clash | silence; a small thud | **Small thud** |
| Block | a guard holds | a thump; a clang | **Metal clang** with a ring |
| Clash | two moves meet | the block sound; a blast | **Clang plus a blast** |
| Whiff, no effect | a move does nothing | silence; a flat drop; air and a small drop | **Air and a small drop** |
| Bluff | the tell was a lie | a laugh (not allowed); a buzzer; falling plucks and a sneer | **Falling plucks and a sneer** |
| Heal | plant recovers | a chime; a harp run with sparkle | **Harp run with sparkle** |
| Skill ready | the skill is charged | a ding; a rising arpeggio | **Rising arpeggio and a bell** |
| Plant faints | knocked out | a thud; a falling slide and a thud | **Falling slide and a thud** |
| Next plant steps in | "GO!" | a horn; a whoosh and two bounds | **Whoosh, two bounds and a rising bell** |
| Boss enraged | it loses its temper | a louder roar; roar, riser, hit, toms | **Roar, riser, hit and toms**; the Battle song speeds up to 160 bpm with a doubled lead, a double-time hat and a busier kick |
| Boss defeated | it comes apart | an explosion; an explosion and sparkles | **Deep boom, crash and a shower of bells** |
| Victory | you win | a jingle; a fanfare | **Brass fanfare** in C, timpani, cymbal and bells |
| Defeat | you lose | a buzzer; a slow falling phrase | **Slow falling phrase** in A minor |
| Watering | the real pump runs | a loop of water; a motor and a stream | **Motor hum, a stream, bubbles, then drips**, as long as the real pump |

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
- Each move has its own name, body action and effect (the table in section 7).
- A plant that reaches 0 HP tips over. It is carried to the bench and the other plant bounds
  in from the bench, growing as it comes forward.
- The screen: the fighting plant's plate is top left (its face, HP, the soil it is fighting
  for, and the plant on the bench under it), the boss's plate is top right, and the four
  move cards form a block of two by two at the bottom right, a little see-through so the
  field shows behind them. A small plate at the bottom left holds the log line. Each card says what the move beats and loses to. The
  skill card shows its charges. Health bars only drop when the blow lands, and a line
  calls out each move by name. Keys 1 to 4 pick a card.
- **The wind-up panel** sits under the boss's plate and points at it: the move it is
  winding up, its type, the grade (SURE, LIKELY 75%, COIN FLIP 50%), the bluff move if there
  is one, and a HEAVY warning. It appears when the last turn has finished playing.
- A mark on the boss's health bar shows where it will become enraged.
- The forest behind the fight is painted once, flattened into one picture and kept, so the
  screen stays smooth on a small computer.

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

The boss is a thorny plant with three hanging flower heads. It is one of the two bosses (the
other is the Sporeling Trio, section 7). A drier tier draws it a little taller.

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

**Without any hardware** (made-up moisture for both plants). The made-up soil behaves like
a pot: it only dries, slowly (50 points takes two to three minutes), and only a pump command
makes it wetter. A watering leaves it at 80% or more and it holds that for 20 seconds before
drying again, so a plant that has just won a fight stays quiet for a couple of minutes.
Plant A starts drier than plant B, so the first boss comes after about half a minute and the
two plants do not dry out together. In this mode the per-plant cooldown is 30 seconds:

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
| `python3 test_server.py` | runs the 90 server tests |

## 15. File map

**Server** (`server/`)

| File | What it holds |
| --- | --- |
| `config.py` | every number: thresholds, timings, pump caps, boss stats, the two plants, skills |
| `state_machine.py` | the five modes and what moves the game between them |
| `battle.py` | the turn rules, the boss's tells, skills, and the second plant stepping in |
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
| `data/bosses.js` | which picture each tier uses, what it calls its moves, and its colours |
| `data/plants.js` | the two plants: looks, arm poses, and the name, action and effect of each move |
| `data/plantRigs.js` | where each moving piece of the plants sits (made by a script from the pictures) |
| `render/plantRig.js` | a plant built from moving pieces: sway, springs, face, moods, actions |
| `render/petParade.js` | the plants hopping behind the dragon and reacting to a boss |
| `render/fxKit.js` | the paint box for effects: sparks, beams, lightning, slashes, shockwaves |
| `render/battleFx.js` | what each plant move looks like |
| `render/bossFx.js` | what each boss move looks like |
| `ui/battleHud.js` | everything written on the battle screen: plates, bars, move cards, banners, numbers |
| `ui/statusBar.js` | the meters, demo button and sound switch on top of the forest |
| `audio.js` | every sound effect and both tunes, made in code |
| `state/wsSource.js` | the connection to the server |

## 16. What is placeholder or not built yet

- **Soil calibration.** `SOIL_RAW_DRY` and `SOIL_RAW_WET` are guesses until the real
  sensors are measured wet and dry.
- **Pump cap.** `PUMP_MAX_MS` is a cautious guess. It must be set at or below the
  firmware's real cap.
- **Battle numbers.** Balanced by simulation only (bot against bot). They need real people
  playing on the Jetson before the demo.
- **Grow light.** The hardware has one, but the game has no sunlight meter and never switches it on.
- **Firmware over MQTT.** The ESP32 does not publish to MQTT by itself yet;
  `serial_bridge.py` fills the gap for soil only. It does not pass on pad (NFC) readings,
  so through the bridge no plant is ever "on the cube" unless a pad message is published by hand
  (or `PLANTS_NEED_PADS` is turned off in `config.py`).
- **Boss art.** Two bosses, the Drought Chomper and the Sporeling Trio, each used at every tier. The old "Desert Dragon" was only the Chomper with another name, so it is gone.
- **Storage screen.** A placeholder.
- **Vision / Jetson.** Not started.
- **Plant art.** Each plant has one picture, seen from the front, in the forest and in the
  battle alike. There is no back view.
