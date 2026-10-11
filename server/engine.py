"""GameEngine glues the pure pieces together. No network code and no file I/O, so it runs in tests.
The clock is passed in as `now` (monotonic seconds) everywhere.

Pump log and stats live here as data; main.py saves them through persist.py whenever `dirty` is set
(see persisted() and restore())."""
import logging
import random
from dataclasses import replace
from typing import Optional

import battle as B
import config as C
import rewards as R
import state_machine as S

log = logging.getLogger("engine")

BATTLE_OPEN_SECONDS = 0.5   # first move accepted this long after a fight starts


def fresh_stats(date: str = "") -> dict:
    return {"date": date, "fights": 0, "wins": 0, "waterings": 0, "water_ms": 0}


class GameEngine:
    def __init__(self, creatures: Optional[dict] = None, rng: Optional[random.Random] = None):
        self.game = S.Game()
        self.creatures = creatures or {}
        self.rng = rng or random.Random()
        self.soil_pct = {p: 100.0 for p in C.PLANTS}
        self.last_soil_at = {p: None for p in C.PLANTS}   # last soil reading per plant
        self.pads = {p: "" for p in C.PLANTS}
        self.pumps = {p: [] for p in C.PLANTS}            # (time, ms) of every pump in the window
        self.result = None           # the last finished fight, see _finish_battle
        self.stats = fresh_stats()
        self.dirty = False           # pump log or stats changed: main.py saves them
        self.battle: Optional[B.Battle] = None
        self.fight: Optional[dict] = None   # id, plant, tier, source, over_at of self.battle
        self.health = 100.0          # overall plant health, a mood: fades while the soil is dry
        self._last_tick: Optional[float] = None
        # Manual battles: a screen is connected and the player picks each move. With nobody
        # connected (or in tests) the game plays the turns itself so a fight never hangs.
        self.manual = False
        self.idle = False            # a turn timed out: the game plays on until someone presses
        self.move_ready_at = 0.0     # earliest time the next move is accepted
        self.move_deadline = 0.0     # after this the game picks the move
        self.last_seen: Optional[float] = None  # last time the ESP32 was heard from

    def _set(self, new: S.Game):
        if new.mode != self.game.mode:
            log.info("mode %s -> %s (boss=%s source=%s)", self.game.mode, new.mode,
                     new.boss_plant, new.source)
        self.game = new

    # inputs -----------------------------------------------------------
    def on_soil_raw(self, plant: str, raw: int, now: float) -> list:
        self._heard_from_esp32(now)
        self.last_soil_at[plant] = now
        self.soil_pct[plant] = S.soil_pct(raw)
        self._set(S.on_soil(self.game, plant, self.soil_pct[plant], now))
        return self.tick(now)

    def _heard_from_esp32(self, now: float):
        """Any reading means the ESP32 is alive, so readings are fresh again."""
        self.last_seen = now
        if self.game.stale:
            log.info("ESP32 is back")
            self._set(S.on_status(self.game, True))

    def on_pad(self, plant: str, uid: str):
        self.pads[plant] = uid.strip()

    def on_esp_status(self, text: str, now: Optional[float] = None):
        online = text.strip() == "online"
        if online and now is not None:
            self.last_seen = now
        self._set(S.on_status(self.game, online))
        self._sync_battle(now if now is not None else (self._last_tick or 0.0))

    def _check_stale(self, now: float):
        """No reading for a while counts as offline, even if the ESP32 never said goodbye."""
        if self.last_seen is None or self.game.stale:
            return
        if now - self.last_seen > C.ESP32_STALE_SECONDS:
            log.info("no ESP32 reading for %.0fs, treating it as offline", now - self.last_seen)
            self._set(S.on_status(self.game, False))

    def pick_demo_plant(self) -> str:
        """The pad with a creature, or the lower water meter if both or neither has one."""
        with_creature = [p for p in C.PLANTS if self.pads[p]]
        pool = with_creature if len(with_creature) == 1 else list(C.PLANTS)
        return min(pool, key=lambda p: self.soil_pct[p])

    def demo_available(self) -> bool:
        """A demo boss can be called while walking or cooling down, but not while a finished fight
        is still on screen (result hold), so a press can never cut a result short."""
        return self.game.mode in (S.WALKING, S.COOLDOWN) and self.battle is None

    def on_demo_boss(self, now: float, plant: Optional[str] = None) -> list:
        """Demo button (WebSocket) or the optional laptop topic."""
        if not self.demo_available():
            log.info("demo boss ignored, mode is %s%s", self.game.mode,
                     " (result on screen)" if self.battle is not None else "")
            return self.tick(now)
        plant = plant or self.pick_demo_plant()
        before = self.game.mode
        tier = max(1, S.tier_for(self.soil_pct[plant]))
        self._set(S.on_demo(self.game, plant, now, tier))
        if self.game.mode == before:
            log.info("demo boss ignored, mode is %s", before)
        return self.tick(now)

    def on_player_move(self, move: str, now: float, turn: Optional[int] = None) -> list:
        """A move from a screen: attack, guard, special or skill, tagged with the turn it answers.
        A valid move name always wakes the game from idle, even when the move itself is dropped
        (wrong turn, or the lockout). The client uses turn -1 for exactly that: "I'm here, take
        over", while its buttons are still locked. Only a valid, current, unlocked move plays."""
        if not self._fight_active() or not self.manual or move not in B.PLAYER_MOVES:
            return []
        self.idle = False
        self.move_deadline = max(self.move_deadline, now + C.PLAYER_MOVE_TIMEOUT_SECONDS)
        if now < self.move_ready_at:
            return []
        if turn is not None and turn != self.battle.turn:
            return []
        self.battle = B.play_turn(self.battle, self.rng, move)
        return self._after_turn(now, auto=False)

    def set_manual(self, manual: bool, now: float):
        """A screen connected (True) or the last one left (False)."""
        if manual == self.manual:
            return
        self.manual = manual
        if self._fight_active():
            if manual and not self.idle:
                self.move_deadline = max(self.move_deadline, now + C.PLAYER_MOVE_TIMEOUT_SECONDS)
            elif not manual:
                self.move_deadline = min(self.move_deadline, now + C.AUTO_TURN_SECONDS)

    def on_debug_boss(self, payload: str, now: float) -> list:
        p = payload.strip().upper()
        return self.on_demo_boss(now, p) if p in C.PLANTS else []

    def set_today(self, date: str):
        """Stats count today only: a new local date starts them again."""
        if self.stats.get("date") != date:
            self.stats = fresh_stats(date)
            self.dirty = True

    # time -------------------------------------------------------------
    def tick(self, now: float) -> list:
        commands = []
        self._update_health(now)
        self._check_stale(now)
        self._set(S.on_tick(self.game, now))
        self._sync_battle(now)

        if self.game.mode == S.BATTLE and self.battle is None:
            self._start_battle(now)

        if self._fight_active() and now >= self.move_deadline:
            if self.manual:
                self.idle = True     # nobody picked: the game plays on until someone presses
            self.battle = B.play_turn(self.battle, self.rng)
            commands = self._after_turn(now, auto=True)
        return commands

    def _fight_active(self) -> bool:
        return (self.game.mode == S.BATTLE and self.battle is not None
                and self.fight is not None and self.fight["over_at"] is None)

    def _sync_battle(self, now: float):
        """A fight the game left without a winner (wet soil, ESP32 lost) ends as dismissed.
        A finished fight stays visible for RESULT_HOLD_SECONDS, then goes."""
        if self.battle is None:
            return
        if self.fight["over_at"] is None and self.game.mode != S.BATTLE:
            self.fight["over_at"] = now
            self.battle = replace(self.battle, intent=None, boss_next="")
            self.result = {"fight": self.fight["id"], "outcome": "dismissed",
                           "plant": self.fight["plant"], "water_ms": 0, "blocked": None}
            log.info("fight %s dismissed", self.fight["id"])
        elif self.fight["over_at"] is not None and (
                now >= self.fight["over_at"] + C.RESULT_HOLD_SECONDS
                or self.game.mode in (S.BOSS, S.BATTLE)):
            self.battle = None
            self.fight = None

    def fighter(self, plant: str) -> B.Stats:
        """A plant's fighting numbers: the known figure on its pad, else the plant's own."""
        return self.creatures.get(self.pads.get(plant, ""), B.plant_fighter(plant))

    def _start_battle(self, now: float):
        # The plant that called the boss fights first. The others wait on the bench, driest first.
        first = self.game.boss_plant
        tier = self.game.tier or 1
        bench = sorted((p for p in C.PLANTS if p != first), key=lambda p: self.soil_pct[p])
        b = B.start(self.fighter(first), B.boss_for_tier(tier), plant=first,
                    bench=[(p, self.fighter(p)) for p in bench], show_rate=B.show_rate_for_tier(tier))
        self.battle = B.roll_intent(b, self.rng)
        self.fight = {"id": "%06x" % self.rng.getrandbits(24), "plant": first, "tier": tier,
                      "source": self.game.source, "over_at": None}
        self.idle = False
        self.move_ready_at = now + BATTLE_OPEN_SECONDS
        self.move_deadline = now + (C.PLAYER_MOVE_TIMEOUT_SECONDS if self.manual else C.AUTO_TURN_SECONDS)
        self.stats["fights"] += 1
        self.dirty = True

    def _after_turn(self, now: float, auto: bool) -> list:
        move = dict(self.battle.last_move, auto=auto)
        self.battle = replace(self.battle, last_move=move)
        extra = 0.0
        if move.get("swap"):                       # a plant fainted: time for the next one to come in
            extra += C.SWAP_EXTRA_SECONDS
        if move.get("blooms_spent"):               # an unleashed skill plays longer
            extra += C.UNLEASH_EXTRA_SECONDS_PER_BLOOM * move["blooms_spent"]
        pace = C.AUTO_TURN_SECONDS if (self.idle or not self.manual) else C.PLAYER_MOVE_TIMEOUT_SECONDS
        self.move_ready_at = now + C.BATTLE_TURN_SECONDS + extra
        self.move_deadline = now + pace + extra
        result = B.winner(self.battle)
        return self._finish_battle(result == "creature", now) if result else []

    def condition(self) -> str:
        if self.health <= 0:
            return "wilted"
        if self.health < C.HEALTH_WILTING_BELOW:
            return "wilting"
        if self.health < C.HEALTH_WEARY_BELOW:
            return "weary"
        return "healthy"

    def moisture_tier(self) -> int:
        """How dry the driest plant is: 0 chill, 1 dry, 2 very dry, 3 bone dry."""
        return S.tier_for(min(self.soil_pct.values()))

    def _update_health(self, now: float):
        """Overall health fades while any plant is dry, faster the drier it is."""
        if self._last_tick is not None:
            dt = min(max(now - self._last_tick, 0.0), 1.0)
            tier = self.moisture_tier()
            if tier >= 1:
                self.health -= C.HEALTH_DECAY_PER_SEC[tier] * dt
            else:
                self.health += C.HEALTH_RECOVER_PER_SEC * dt
            self.health = min(100.0, max(0.0, self.health))
        self._last_tick = now

    # pump safety --------------------------------------------------------
    def _fresh(self, plant: str, now: float) -> bool:
        """This plant's soil was heard from recently and the link is not stale."""
        seen = self.last_soil_at[plant]
        return not self.game.stale and seen is not None and now - seen <= C.ESP32_STALE_SECONDS

    def _prune(self, now: float):
        for p in C.PLANTS:
            self.pumps[p] = [(t, ms) for t, ms in self.pumps[p]
                             if now - min(t, now) < C.PUMP_BUDGET_WINDOW_SECONDS]

    def _finish_battle(self, won: bool, now: float) -> list:
        fight = self.fight
        plant = fight["plant"]
        new, _ = S.on_battle_done(self.game, won, now)
        self._set(new)
        fight["over_at"] = now
        self.battle = replace(self.battle, intent=None, boss_next="")
        self.result = {"fight": fight["id"], "outcome": "won" if won else "lost", "plant": plant,
                       "water_ms": 0, "blocked": None}
        self.dirty = True
        if not won:
            return []
        self.health = min(100.0, self.health + C.HEALTH_WIN_BONUS)
        self.stats["wins"] += 1
        self._prune(now)
        cmd, blocked = R.water_decision(plant, self.soil_pct[plant], now, self.pumps[plant],
                                        fresh=self._fresh(plant, now),
                                        demo=fight["source"] == C.SOURCE_DEMO, tier=fight["tier"])
        if cmd is None:
            self.result["blocked"] = blocked
            log.info("reward for %s blocked: %s (soil %.0f%%)", plant, blocked, self.soil_pct[plant])
            return []
        ms = int(cmd.payload)
        self.pumps[plant].append((now, ms))
        self.result["water_ms"] = ms
        self.stats["waterings"] += 1
        self.stats["water_ms"] += ms
        log.info("command %s %s", cmd.topic, cmd.payload)
        return [cmd]

    def pump_failed(self, cmd, now: float):
        """The pump command could not be published: undo it everywhere, so the log, the stats and
        the screen only ever count water that was really sent."""
        plant = cmd.topic.rsplit("/", 1)[-1]
        if plant not in self.pumps:
            return
        ms = int(cmd.payload)
        for i in range(len(self.pumps[plant]) - 1, -1, -1):
            if self.pumps[plant][i][1] == ms:
                del self.pumps[plant][i]
                break
        self.stats["waterings"] = max(0, self.stats["waterings"] - 1)
        self.stats["water_ms"] = max(0, self.stats["water_ms"] - ms)
        if self.result and self.result["plant"] == plant and self.result["water_ms"] == ms:
            self.result["water_ms"] = 0
            self.result["blocked"] = R.PUBLISH_FAILED
        self.dirty = True
        log.warning("pump command %s %s was not published, rolled back", cmd.topic, cmd.payload)

    def persisted(self, now: float) -> dict:
        """What persist.save() writes: the pump log as ages (seconds ago) and today's stats."""
        self._prune(now)
        return {"pumps": {p: [(max(0.0, now - t), ms) for t, ms in self.pumps[p]] for p in C.PLANTS},
                "stats": dict(self.stats)}

    def restore(self, data: dict, now: float):
        """Load what persist.load() read. Ages turn back into times on this clock."""
        pumps = data.get("pumps") or {}
        self.pumps = {p: [(now - age, int(ms)) for age, ms in pumps.get(p, [])] for p in C.PLANTS}
        if data.get("stats"):
            self.stats = {**fresh_stats(), **data["stats"]}

    # output -----------------------------------------------------------
    def _battle_snapshot(self, b: B.Battle, now: float) -> dict:
        over = self.fight["over_at"] is not None
        accepting = (not over and self.game.mode == S.BATTLE and self.manual
                     and now >= self.move_ready_at)
        skill = B.skill_of(b.creature)
        team = {b.plant: {"name": b.creature.name, "hp": b.creature_hp, "max_hp": b.creature.hp,
                          "state": "fighting"}}
        team.update({p: {"name": s.name, "hp": s.hp, "max_hp": s.hp, "state": "ready"} for p, s in b.bench})
        team.update({p: {"name": s.name, "hp": 0, "max_hp": s.hp, "state": "down"} for p, s in b.fallen})
        return {
            "id": self.fight["id"],
            "turn": b.turn,
            "plant": b.plant,      # which plant is fighting right now
            "team": team,          # every plant in this fight: fighting, ready (on the bench) or down
            "creature": b.creature.name,
            "creature_hp": b.creature_hp,
            "creature_max_hp": b.creature.hp,
            "boss_hp": b.boss_hp,
            "intent": None if over else {"move": b.intent,
                                         "counter": B.COUNTER[b.intent] if b.intent else None},
            "blooms": b.blooms,
            "blooms_max": C.BLOOM_MAX,
            "skill": None if skill is None else {
                "id": b.creature.skill,
                "name": skill["name"],
                "kind": B.skill_kind(skill),
                "power": B.skill_power(b),
                "ready": b.skill_ready_in == 0,
                "ready_in": b.skill_ready_in,
            },
            "last_move": None if b.last_move is None else dict(b.last_move),
            "manual": self.manual,
            "autopilot": not over and (self.idle or not self.manual),
            "accepting_move": accepting,
            "move_deadline_in_ms": max(0, int(round((self.move_deadline - now) * 1000))) if accepting else None,
            "over": over,
        }

    def _boss_snapshot(self) -> Optional[dict]:
        g, b = self.game, self.battle
        if b is not None:
            return {"plant": self.fight["plant"], "name": b.boss.name, "tier": self.fight["tier"],
                    "hp": b.boss_hp, "max_hp": b.boss.hp, "type": "drought", "source": self.fight["source"]}
        if g.boss_plant is not None and g.mode in (S.BOSS, S.BATTLE):
            stats = B.boss_for_tier(g.tier or 1)
            return {"plant": g.boss_plant, "name": stats.name, "tier": g.tier, "hp": stats.hp,
                    "max_hp": stats.hp, "type": "drought", "source": g.source}
        return None

    def snapshot(self, now: Optional[float] = None) -> dict:
        """The state message (protocol v2). Built field by field: nothing secret can slip in."""
        if now is None:
            now = self._last_tick or 0.0
        g, b = self.game, self.battle
        return {
            "v": C.PROTOCOL_VERSION,
            "mode": g.mode,
            "creatures": {p: self.pads[p] or None for p in C.PLANTS},
            "meters": {
                "water": {p: round(self.soil_pct[p], 1) for p in C.PLANTS},
                "thirsty": {p: self.soil_pct[p] < C.SOIL_DRY_THRESHOLD_PCT for p in C.PLANTS},
                "stale": g.stale,
            },
            "fighters": {p: {"name": self.fighter(p).name,
                             "skill": (B.skill_of(self.fighter(p)) or {}).get("name")} for p in C.PLANTS},
            "health": int(round(self.health)),
            "condition": self.condition(),
            "tier": self.moisture_tier(),
            "demo_available": self.demo_available(),
            "boss": self._boss_snapshot(),
            "battle": None if b is None else self._battle_snapshot(b, now),
            "result": None if self.result is None else dict(self.result),
            "stats": {k: self.stats[k] for k in ("fights", "wins", "waterings", "water_ms")},
        }
