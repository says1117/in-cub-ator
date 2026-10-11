"""GameEngine glues the pure pieces together. No network code, so it runs in tests."""
import logging
import random
from dataclasses import replace
from typing import Optional

from . import battle as B
from . import config as C
from . import rewards as R
from . import state_machine as S

log = logging.getLogger("engine")


class GameEngine:
    def __init__(self, creatures: Optional[dict] = None, rng: Optional[random.Random] = None):
        self.game = S.Game()
        self.creatures = creatures or {}
        self.rng = rng or random.Random()
        self.soil_pct = {p: 100.0 for p in C.PLANTS}
        self.pads = {p: "" for p in C.PLANTS}
        self.last_reward_at = {p: float("-inf") for p in C.PLANTS}
        self.last_reward = None
        self.battle: Optional[B.Battle] = None
        self.next_turn_at = 0.0
        self.health = 100.0          # overall plant health, fades while the soil is dry
        self._last_tick: Optional[float] = None
        # Manual battles: the player picks each move. With nobody connected (or in tests) the game
        # plays the turns itself so a fight never hangs.
        self.manual = False
        self.move_ready_at = 0.0     # earliest time the next move is accepted
        self.move_deadline = 0.0     # after this the game picks the move
        self.last_seen: Optional[float] = None  # last time the ESP32 sent a reading
        # After a lost fight the battle stays in the state message for a moment, so the screen
        # can play the last blow. {"plant", "tier", "source", "until"} or None.
        self.lost: Optional[dict] = None
        self.boss_kind: Optional[str] = None   # which kind of boss is here now: see config.BOSS_KINDS

    def _set(self, new: S.Game):
        if new.mode != self.game.mode:
            log.info("mode %s -> %s (boss=%s source=%s)", self.game.mode, new.mode,
                     new.boss_plant, new.source)
        if new.boss_plant is None:
            self.boss_kind = None
        elif self.boss_kind is None:
            self.boss_kind = self.rng.choice(sorted(C.BOSS_KINDS))   # every kind has the same chance
            log.info("the boss is a %s", C.BOSS_KINDS[self.boss_kind])
        self.game = new

    # inputs -----------------------------------------------------------
    def on_soil_raw(self, plant: str, raw: int, now: float) -> list:
        self._heard_from_esp32(now)
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
        # "online" starts the silence clock but never resets it: only readings prove the soil
        # numbers are fresh, so a repeated status message cannot hide dead sensors.
        if online and now is not None and (self.last_seen is None or self.game.stale):
            self.last_seen = now
        self._set(S.on_status(self.game, online))
        if self.game.mode not in (S.BATTLE, S.REWARD):
            self.battle = None

    def _check_stale(self, now: float):
        """No reading for a while counts as offline, even if the ESP32 never said goodbye."""
        if self.last_seen is None or self.game.stale:
            return
        if now - self.last_seen > C.ESP32_STALE_SECONDS:
            log.info("no ESP32 reading for %.0fs, treating it as offline", now - self.last_seen)
            self._set(S.on_status(self.game, False))
            if self.game.mode not in (S.BATTLE, S.REWARD):
                self.battle = None

    def pick_demo_plant(self) -> str:
        """The pad with a creature, or the lower water meter if both or neither has one."""
        with_creature = [p for p in C.PLANTS if self.pads[p]]
        pool = with_creature if len(with_creature) == 1 else list(C.PLANTS)
        return min(pool, key=lambda p: self.soil_pct[p])

    def on_demo_boss(self, now: float, plant: Optional[str] = None) -> list:
        """Demo button (WebSocket) or the optional laptop topic."""
        plant = plant or self.pick_demo_plant()
        before = self.game.mode
        tier = max(1, S.tier_for(self.soil_pct[plant]))
        self._set(S.on_demo(self.game, plant, now, tier))
        if self.game.mode == before:
            log.info("demo boss ignored, mode is %s", before)
        return self.tick(now)

    def on_player_move(self, move: str, now: float) -> list:
        """The player's move for this turn: attack, guard, special or skill."""
        if not self.manual or self.game.mode != S.BATTLE or self.battle is None:
            return []
        if move not in B.PLAYER_MOVES or now < self.move_ready_at:
            return []
        self.battle = B.play_turn(self.battle, self.rng, move)
        return self._after_turn(now)

    def on_debug_boss(self, payload: str, now: float) -> list:
        p = payload.strip().upper()
        return self.on_demo_boss(now, p) if p in C.PLANTS else []

    # time -------------------------------------------------------------
    def tick(self, now: float) -> list:
        commands = []
        self._update_health(now)
        self._check_stale(now)
        self._set(S.on_tick(self.game, now))

        if self.game.mode == S.BATTLE and self.battle is None:
            self._start_battle(now)

        if self.game.mode == S.BATTLE and self.battle is not None:
            if self.manual:
                if now >= self.move_deadline:  # nobody picked, the game does
                    self.battle = B.play_turn(self.battle, self.rng)
                    commands = self._after_turn(now)
            elif now >= self.next_turn_at:
                self.battle = B.play_turn(self.battle, self.rng)
                commands = self._after_turn(now)

        if self.lost and (now >= self.lost["until"] or self.game.mode in (S.BOSS, S.BATTLE)):
            self.lost = None
        if self.game.mode not in (S.BATTLE, S.REWARD) and self.battle and not self.lost:
            self.battle = None
        return commands

    def _boss_stats(self, tier: int) -> B.Stats:
        """The boss's numbers come from how dry it is, its name from which kind it is."""
        stats = B.boss_for_tier(tier)
        return replace(stats, name=C.BOSS_KINDS[self.boss_kind]) if self.boss_kind else stats

    def fighter(self, plant: str) -> B.Stats:
        """A plant's fighting numbers: the known figure on its pad, else the plant's own."""
        stats = self.creatures.get(self.pads.get(plant, ""), B.plant_fighter(plant))
        if self.health <= 0:  # a wilted plant hits weaker
            stats = B.weakened(stats, C.WILTED_ATK_FACTOR)
        return stats

    def _start_battle(self, now: float):
        # The plant that called the boss fights first. The others wait on the bench, driest first.
        first = self.game.boss_plant
        bench = sorted((p for p in C.PLANTS if p != first), key=lambda p: self.soil_pct[p])
        self.last_reward = None   # nothing has been won yet in this fight
        tier = self.game.tier or 1
        charge = C.SKILL_CHARGE_START if self.health >= C.HEALTH_WEARY_BELOW else C.SKILL_CHARGE_START_WEARY
        self.battle = B.start(self.fighter(first), self._boss_stats(tier), plant=first,
                              bench=[(p, self.fighter(p)) for p in bench],
                              tier=tier, charge=charge, rng=self.rng)
        self.next_turn_at = now + C.BATTLE_TURN_SECONDS
        self.move_ready_at = now + 0.5
        self.move_deadline = now + C.PLAYER_MOVE_TIMEOUT_SECONDS

    def _after_turn(self, now: float) -> list:
        self.next_turn_at = now + C.BATTLE_TURN_SECONDS
        self.move_ready_at = now + C.BATTLE_TURN_SECONDS  # time for the client to show the turn
        # the time to choose starts when a move can be chosen, not while the last turn is still playing
        self.move_deadline = self.move_ready_at + C.PLAYER_MOVE_TIMEOUT_SECONDS
        last = self.battle.last_move or {}
        log.info("turn %d: %s vs %s (shown %s), hit=%s, plant %d hp, boss %d hp", self.battle.turn,
                 last.get("skill") or last.get("creature"), last.get("boss"), last.get("shown"),
                 last.get("hit"), self.battle.creature_hp, self.battle.boss_hp)
        extra = (C.SWAP_EXTRA_SECONDS if last.get("swap") else 0.0) + (C.ENRAGE_EXTRA_SECONDS if last.get("enraged") else 0.0)
        if extra:   # a plant fainted and the next one comes in, or the boss stops to roar
            self.next_turn_at += extra
            self.move_ready_at += extra
            self.move_deadline += extra
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
        """Overall health fades while any plant is dry and nobody is fighting for it, faster the
        drier it is."""
        if self._last_tick is not None:
            dt = min(max(now - self._last_tick, 0.0), 1.0)
            tier = self.moisture_tier()
            if self.game.mode in (S.BOSS, S.BATTLE, S.REWARD):
                pass   # help is on the way: health holds while a boss is being fought
            elif tier >= 1:
                self.health -= C.HEALTH_DECAY_PER_SEC[tier] * dt
            else:
                self.health += C.HEALTH_RECOVER_PER_SEC * dt
            self.health = min(100.0, max(0.0, self.health))
        self._last_tick = now

    def _finish_battle(self, won: bool, now: float) -> list:
        demo = self.game.source == C.SOURCE_DEMO
        tier = self.game.tier or 1
        kind = self.boss_kind   # read now: a lost fight clears the boss as soon as the state changes
        new, plant = S.on_battle_done(self.game, won, now)
        self._set(new)
        if won:
            self.health = min(100.0, self.health + C.HEALTH_WIN_BONUS)
        else:
            self.lost = {"plant": self.battle.plant, "tier": tier, "kind": kind, "until": now + C.LOSS_DISPLAY_SECONDS,
                         "source": C.SOURCE_DEMO if demo else C.SOURCE_SOIL}
        if plant is None:
            return []
        if self.game.stale or self.last_seen is None:
            log.info("reward for %s blocked, ESP32 %s", plant,
                     "offline" if self.game.stale else "not heard from yet")
            return []
        pct = self.soil_pct[plant]
        cmd = R.water_reward(plant, pct, now, self.last_reward_at[plant], demo=demo, tier=tier)
        if cmd is None:
            log.info("reward for %s blocked (soil %.0f%%, demo=%s)", plant, pct, demo)
            return []
        self.last_reward_at[plant] = now
        self.last_reward = {"type": "water", "plant": plant, "size": int(cmd.payload), "tier": tier}
        log.info("command %s %s", cmd.topic, cmd.payload)
        return [cmd]

    # output -----------------------------------------------------------
    def _battle_snapshot(self, b) -> dict:
        skill = B.skill_of(b.creature)
        left = min(C.PLAYER_MOVE_TIMEOUT_SECONDS, max(0.0, self.move_deadline - (self._last_tick or 0.0)))
        team = {b.plant: {"name": b.creature.name, "hp": b.creature_hp, "max_hp": b.creature.hp,
                          "state": "fighting"}}
        team.update({p: {"name": s.name, "hp": s.hp, "max_hp": s.hp, "state": "ready"} for p, s in b.bench})
        team.update({p: {"name": s.name, "hp": 0, "max_hp": s.hp, "state": "down"} for p, s in b.fallen})
        return {
            "turn": b.turn,
            "plant": b.plant,      # which plant is fighting right now
            "team": team,          # every plant in this fight: fighting, ready (on the bench) or down
            "creature": b.creature.name,
            "creature_hp": b.creature_hp,
            "creature_max_hp": b.creature.hp,
            "boss_hp": b.boss_hp,
            "last_move": b.last_move,
            # the tell for the coming turn: the move the boss shows, how sure it is (grade and
            # chance), the move it would use if this is a bluff, and whether it is a heavy hit
            "intent": b.intent,
            "enraged": b.enraged,
            "enrage_hp": int(b.boss.hp * C.ENRAGE_AT),
            "hints": b.tier in C.TIER_HINTS,   # the cards may say how each move does against the tell
            "skill": None if skill is None else {
                "name": skill["name"],
                "ready": B.skill_ready(b),
                "charge": b.charge,                 # turns won so far
                "need": C.SKILL_CHARGE_NEED,        # turns to win before it can be used
            },
            "manual": self.manual,
            # false while the last turn is still being shown: a move sent then would be thrown away
            "awaiting_move": (self.manual and B.winner(b) is None
                              and (self._last_tick or 0.0) >= self.move_ready_at),
            "move_seconds_left": int(left + 0.999) if self.manual else None,
        }

    def snapshot(self) -> dict:
        g, b = self.game, self.battle
        boss_stats = b.boss if b else self._boss_stats(g.tier or 1)
        lost = self.lost if (b and g.boss_plant is None) else None   # the last blow of a lost fight
        return {
            "creatures": {p: self.pads[p] or None for p in C.PLANTS},
            "meters": {
                "water": {p: round(self.soil_pct[p], 1) for p in C.PLANTS},
                "stale": g.stale,
            },
            "mode": g.mode,
            "fighters": {p: {"name": self.fighter(p).name,
                             "skill": (B.skill_of(self.fighter(p)) or {}).get("name")} for p in C.PLANTS},
            "health": round(self.health, 1),
            "condition": self.condition(),
            "tier": self.moisture_tier(),
            "boss": None if (g.boss_plant is None and not lost) else {
                "plant": lost["plant"] if lost else g.boss_plant,
                "name": boss_stats.name,
                "kind": (lost or {}).get("kind") or self.boss_kind or "chomper",
                "tier": lost["tier"] if lost else g.tier,
                "hp": b.boss_hp if b else boss_stats.hp,
                "max_hp": boss_stats.hp,
                "type": "drought",
                "source": lost["source"] if lost else g.source,
            },
            "battle": None if b is None else self._battle_snapshot(b),
            "reward": self.last_reward,
        }
