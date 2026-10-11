> Historical comparison before the complete game import. For current behavior, see [GAME_IMPORT.md](GAME_IMPORT.md).

# Supplied ZIP versus current branch

Comparison date: October 11, 2026. Source: `in-cub-ator-sporelings-boss.zip`
from Downloads, extracted to a temporary folder. Target: the current **working
folder** on `okayuu-branch`, including uncommitted work. A source-only file means
it was not imported; it does not mean it was deleted from this branch.

## Commit status

Commit `b70202a` contains the frontend UI/boss merge and earlier client features.
The new announced combat/plant skills, this comparison, and combat documentation
are currently uncommitted. Existing backend edits, simulator edits, progression,
watering tests and `plants.db` are also uncommitted. No backend code was replaced
by the boss merge. The generated download ZIP is not a Git commit.

## Behavior differences

| Area | Supplied ZIP | Current working branch |
|---|---|---|
| Backend | Standalone Python game engine/state machine, WebSocket game state on port 8765 | Existing FastAPI plant API, SQLite plant data, WebSocket `/ws/plants` on port 8000 |
| Plant identity | A/B, fighters Ember/Zest and optional tagged figures | `PLANT_001`/`PLANT_002`, Cast Iron/Monstera from plant data; A/B used internally for artwork |
| Boss order | Server randomly chooses Chomper or Trio | Completed fights alternate Drought Chomper → Sporeling Trio, stored in browser local storage |
| Abandoned encounter | Driven by donor server state | Reopened encounter keeps boss identity; combat HP, turns, cooldown and blooms restart |
| Boss stats | Moisture tiers: HP 38/44/48, attack 9/11/13 | Both level 8, HP 100, stamina 70; normal hit 4–7, exhausted 2–4 |
| Battle ownership | Server plans and resolves moves; client sends move actions | Client resolves battles locally using live plant readings; backend still owns watering/levels |
| Move reveal | Boss shows a tell before choice, with confidence/bluff hints | Plant announces move, pause, boss announces move, pause, outcome, animation and damage |
| Counter rule | Attack > Special > Guard > Attack | Same counter order |
| Hit outcomes | Winning counter deals fixed fighter attack; losing counter deals no outgoing damage; tie grazes plant | Critical deals 1.5× attack, weak deals 0.5× and takes full hit, offensive clash halves both, Guard clash deals zero; Attack/Special can miss 10% |
| Plant attack | Ember 8, Zest 7, modified by tag/wilting | Random 16–23 plus level−1; both use level-scaled base |
| Combat resources | No matching water/light combat cost system | Attack costs 5 water/4 light; Guard recovers water/HP; Special recovers light/HP, level-scaled |
| Inferno Bloom | 1.75× attack, charges from counter wins | 1.25× level-scaled attack; starts ready, four completed ordinary turns to recharge |
| Sunburst | Heal 8, 0.75× attack, charges from counter wins | Heal 8+level−1 (capped), 0.5× level-scaled attack; same four-turn cooldown |
| Bloom bonus | Not applied by the donor Python resolver | Critical counters earn up to 3 blooms; damage wipes them; skill consumes them for +50% damage each |
| Tagged figure skills | Thorn Burst, Photosynthesis, Bark Shield assigned by figure data | Visual definitions remain, but active combat uses plant signatures only; no figure skill assignment |
| Team defeat | Second plant replaces first when it faints; lose when both fall | Selected plant fights alone; its faint ends the fight |
| Automatic move | Picks a counter after 10-second timeout | Player-controlled turns; no timeout/autopilot battle |
| Boss strategy | Confidence grades, bluffs, anti-repeat counters, enrage at half HP, tier-specific heavy attacks | Random move choice; no confidence/bluff/anti-repeat/enrage damage system |
| Heavy laser | Tier 2/3 heavy hit ×2; tier 1 none | Every third offensive boss action becomes a powerful laser, damage +20% rounded up; Guard does not count |
| Victory water | Tier-based MQTT pump command 2000/2500/3000 ms with reward safety/cooldown | HTTP simulated +20 moisture, stored receipt prevents duplicate battle rewards; update via WebSocket |
| Manual water | Donor hardware/game flow | Detail page button HTTP simulated +10 moisture, deduplicated request IDs and WebSocket refresh |
| Full moisture | Donor moisture simulation/health behavior | One level awarded at reaching 100%; no manual/victory water for 10 seconds; then server resets to 60% |
| Hardware | Donor serial bridge, Jetson setup, ESP32/pump topics and kiosk services | Jetson/pump remains simulated; existing target firmware and MQTT layer retained |
| Telemetry | Donor soil/pad hardware and fake publisher/moisture simulator | Existing plant readings include moisture, light, CO₂, HP and level; light/CO₂-only MQTT updates preserve moisture |
| Routes | Donor forest/storage/boss flow | `/`, `/adventure`, `/boss`, `/storage`, `/cast_iron`, `/monstera`; storage opens corresponding species page |
| Plant pages | No matching species detail scenes | Real plant meters, care buttons/sounds, server watering, water/light/CO₂ reading effects |
| Plant growth | Donor art/rig behavior | Larger default detail sprite; moisture below 100 grows it up to 40%; reaching 100 resets normal size with cute pop; enlarged-at-100 feature removed |
| Status bar | Donor forest water/thirst/health presentation | Existing target plant readings adapted; level bars on home/adventure |
| Audio | Donor audio/UI modules | Target procedural audio retained: peaceful walking, tension transformation, fighting, move/impact, victory, care and pop cues; M mutes |
| Spoken voice | No evidence of voice recordings being imported | Move “shouts” are text callouts plus sound effects; no synthesized/spoken narration |
| UI architecture | Monolithic donor BossScene and `ui/battleHud.js`, donor WS state source | BossPresentation artwork/HUD wrapped by active BossScene; legacy scene retained for plant sync; dedicated battle HUD, local plant store/API adapter |
| Boss extension | Kind catalog plus server BOSS_KINDS and tier scaling | Definition catalog with stable IDs; rig factory dispatch; browser boss rotation; documented extension guide |
| Tests | Donor server battle/engine suite | Target tests retained; new watering/telemetry backend tests, boss rotation/catalog tests and combat outcome tests |

## Imported or retained artwork

The exact name **Sporeling Trio** is retained, as are Drought Chomper, the
Spore Gnash/Spore Cannon/Mycelium Quake names, the mushroom image and seven cutout
parts, mushroom rig geometry, and animated renderer. The effects were integrated
into the current renderer alongside its existing charged laser. Existing forest,
Chomper and plant art remains. The old caterpillar PNG exists as an unused legacy
asset; it is not an active third boss.

The current ZIP is a merged project, not a copy of the donor project. Supporting
server/firmware/demo tools shown in the inventory below may predate this merge;
“current only” does not claim they were newly written in this task. `.env` is
listed by filename only; secret/environment values are not included in this report.

## Complete file inventory

This is a byte comparison of source/project files and assets. Dependencies, Git
metadata, build output, caches, `.DS_Store`, the generated ZIP and this report
itself are excluded. Renames/splits appear as source-only and current-only files.

Counts: **23 changed**, **20 source only**, **106 current only**, **61 identical**.

### Changed at the same relative path

- `.gitignore`
- `README.md`
- `client/package-lock.json`
- `client/package.json`
- `client/src/audio.js`
- `client/src/config.js`
- `client/src/data/bosses.js`
- `client/src/data/plants.js`
- `client/src/main.js`
- `client/src/render/bossEntrance.js`
- `client/src/render/bossFx.js`
- `client/src/render/bossRig.js`
- `client/src/render/petParade.js`
- `client/src/render/plantRig.js`
- `client/src/scenes/AdventureScene.js`
- `client/src/scenes/BossScene.js`
- `client/src/scenes/StorageScene.js`
- `client/src/state/wsSource.js`
- `client/src/theme/enchantedForest.js`
- `client/src/ui/statusBar.js`
- `server/config.py`
- `server/deploy/incube-server.service`
- `server/requirements.txt`

### Present only in supplied ZIP

- `PROJECT.md`
- `client/sounds.html`
- `client/src/ui/battleHud.js`
- `server/api.py`
- `server/battle.py`
- `server/creatures.json`
- `server/deploy/incube-bridge.service`
- `server/deploy/incube-client.service`
- `server/deploy/kiosk.sh`
- `server/deploy/mosquitto-incube.conf`
- `server/deploy/setup_jetson.sh`
- `server/engine.py`
- `server/fake_publisher.py`
- `server/main.py`
- `server/moisture_sim.py`
- `server/mqtt_io.py`
- `server/rewards.py`
- `server/serial_bridge.py`
- `server/state_machine.py`
- `server/test_server.py`

### Present only in current branch working folder

- `CONTRACT.md`
- `NOTES.md`
- `art/audio/.gitkeep`
- `art/backgrounds/.gitkeep`
- `art/photos/.gitkeep`
- `art/sprites/.gitkeep`
- `art/tools/photo_to_sprite.py`
- `art/ui/.gitkeep`
- `client/.env`
- `client/public/assets/bosses/catarpillar.png`
- `client/public/assets/characters/cast-iron.png`
- `client/public/assets/characters/dragon.png`
- `client/public/assets/characters/monstera.png`
- `client/public/assets/plants/cast_iron.png`
- `client/public/assets/plants/cast_iron_big.png`
- `client/public/assets/plants/monstera.png`
- `client/public/assets/plants/monstera_big.png`
- `client/src/assets.js`
- `client/src/assets/hero.png`
- `client/src/assets/javascript.svg`
- `client/src/assets/vite.svg`
- `client/src/audio/cues.js`
- `client/src/audio/index.js`
- `client/src/audio/music.js`
- `client/src/audio/synth.js`
- `client/src/battle/arena.js`
- `client/src/battle/combatExchange.js`
- `client/src/battle/hud.js`
- `client/src/battle/icons.js`
- `client/src/counter.js`
- `client/src/legacy/BossScene.js`
- `client/src/render/battle.js`
- `client/src/render/boss.js`
- `client/src/render/bossTellFx.js`
- `client/src/render/effects.js`
- `client/src/render/walk.js`
- `client/src/scenes/BossPresentation.js`
- `client/src/scenes/CastIronScene.js`
- `client/src/scenes/HudScene.js`
- `client/src/scenes/MonsteraScene.js`
- `client/src/services/api.js`
- `client/src/services/plantCare.js`
- `client/src/services/plantGrowth.js`
- `client/src/services/plantReadingEffects.js`
- `client/src/services/plantSkills.js`
- `client/src/services/socket.js`
- `client/src/state/battleTurns.js`
- `client/src/state/bossRotation.js`
- `client/src/state/mockSource.js`
- `client/src/state/plantStore.js`
- `client/src/ui/font.js`
- `client/src/ui/hudArt.js`
- `client/src/ui/hudText.js`
- `client/test/bossCatalog.test.js`
- `client/test/bossRotation.test.js`
- `client/test/combatExchange.test.js`
- `demo/backup-video/.gitkeep`
- `demo/pitch.md`
- `demo/script.md`
- `demo/submission.md`
- `docs/BOSSES.md`
- `docs/COMBAT.md`
- `docs/MERGE_REVIEW.md`
- `firmware/CLAUDE.md`
- `firmware/HANDOFF.md`
- `firmware/calibration.md`
- `firmware/incube_firmware/config.h`
- `firmware/incube_firmware/incube_firmware.ino`
- `firmware/incube_firmware/network.cpp`
- `firmware/incube_firmware/network.h`
- `firmware/incube_firmware/pads.cpp`
- `firmware/incube_firmware/pads.h`
- `firmware/incube_firmware/relays.cpp`
- `firmware/incube_firmware/relays.h`
- `firmware/incube_firmware/safety.cpp`
- `firmware/incube_firmware/safety.h`
- `firmware/incube_firmware/secrets.h.example`
- `firmware/incube_firmware/soil.cpp`
- `firmware/incube_firmware/soil.h`
- `firmware/tests/i2c_scan/i2c_scan.ino`
- `firmware/tests/relay_click/relay_click.ino`
- `firmware/tests/soil_print/soil_print.ino`
- `firmware/tests/tag_read/tag_read.ino`
- `server/CLAUDE.md`
- `server/app/__init__.py`
- `server/app/api.py`
- `server/app/database.py`
- `server/app/main.py`
- `server/app/models.py`
- `server/app/mqtt_client.py`
- `server/app/plants.py`
- `server/app/progression.py`
- `server/app/rewards.py`
- `server/app/state_machine.py`
- `server/app/vision.py`
- `server/data/boss.json`
- `server/data/creatures.json`
- `server/deploy/mosquitto.conf`
- `server/plants.db`
- `server/simulate_pi.py`
- `server/tests/test_battle.py`
- `server/tests/test_rewards.py`
- `server/tests/test_state_machine.py`
- `server/tests/test_watering_reward.py`
- `server/tools/fake_publisher.py`
- `server/tools/force_boss.sh`

### Byte-identical files

- `client/.gitignore`
- `client/CLAUDE.md`
- `client/assets/manifest.json`
- `client/index.html`
- `client/public/assets/bosses/chomper.png`
- `client/public/assets/bosses/chomper/base.png`
- `client/public/assets/bosses/chomper/headL.png`
- `client/public/assets/bosses/chomper/headR.png`
- `client/public/assets/bosses/chomper/jawA.png`
- `client/public/assets/bosses/chomper/jawB.png`
- `client/public/assets/bosses/chomper/leafL.png`
- `client/public/assets/bosses/chomper/leafR.png`
- `client/public/assets/bosses/chomper/leafT.png`
- `client/public/assets/bosses/sporelings.png`
- `client/public/assets/bosses/sporelings/fbody.png`
- `client/public/assets/bosses/sporelings/fcap.png`
- `client/public/assets/bosses/sporelings/lcap.png`
- `client/public/assets/bosses/sporelings/lstem.png`
- `client/public/assets/bosses/sporelings/puddle.png`
- `client/public/assets/bosses/sporelings/rcap.png`
- `client/public/assets/bosses/sporelings/rstem.png`
- `client/public/assets/characters/IMG_4990.png`
- `client/public/assets/plants/ember/base_m.png`
- `client/public/assets/plants/ember/base_s.png`
- `client/public/assets/plants/ember/fist_m.png`
- `client/public/assets/plants/ember/fist_s.png`
- `client/public/assets/plants/ember/handL_m.png`
- `client/public/assets/plants/ember/handL_s.png`
- `client/public/assets/plants/ember/handR_m.png`
- `client/public/assets/plants/ember/handR_s.png`
- `client/public/assets/plants/ember/handT_m.png`
- `client/public/assets/plants/ember/handT_s.png`
- `client/public/assets/plants/ember/leafL_m.png`
- `client/public/assets/plants/ember/leafL_s.png`
- `client/public/assets/plants/ember/leafT_m.png`
- `client/public/assets/plants/ember/leafT_s.png`
- `client/public/assets/plants/zest/base_m.png`
- `client/public/assets/plants/zest/base_s.png`
- `client/public/assets/plants/zest/fist_m.png`
- `client/public/assets/plants/zest/fist_s.png`
- `client/public/assets/plants/zest/handL_m.png`
- `client/public/assets/plants/zest/handL_s.png`
- `client/public/assets/plants/zest/handR_m.png`
- `client/public/assets/plants/zest/handR_s.png`
- `client/public/assets/plants/zest/handT_m.png`
- `client/public/assets/plants/zest/handT_s.png`
- `client/public/assets/plants/zest/leafB_m.png`
- `client/public/assets/plants/zest/leafB_s.png`
- `client/public/assets/plants/zest/leafL_m.png`
- `client/public/assets/plants/zest/leafL_s.png`
- `client/src/data/chomperRig.js`
- `client/src/data/plantRigs.js`
- `client/src/data/sporelingsRig.js`
- `client/src/render/battleFx.js`
- `client/src/render/castShadow.js`
- `client/src/render/dragonBack.js`
- `client/src/render/fxKit.js`
- `client/src/render/sporeRig.js`
- `client/src/style.css`
- `package-lock.json`
- `package.json`
