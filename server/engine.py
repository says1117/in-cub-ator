"""GameEngine glues the pure pieces together. No network code, so it runs in tests."""
import logging
import random
from typing import Optional

import battle as B
import config as C
import rewards as R
import state_machine as S

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
        self.last_seen: Optional[float] = None  # last time the ESP32 was heard from

    def _set(self, new: S.Game):
        if new.mode != self.game.mode:
            log.info("mode %s -> %s (boss=%s source=%s)", self.game.mode, new.mode,
                     new.boss_plant, new.source)
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
        if online and now is not None:
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

        if self.game.mode not in (S.BATTLE,) and self.battle and self.game.mode != S.REWARD:
            self.battle = None
        return commands

    def _start_battle(self, now: float):
        uid = self.pads.get(self.game.boss_plant, "")
        creature = self.creatures.get(uid, B.Stats())
        if self.health <= 0:  # a wilted plant hits weaker
            creature = B.weakened(creature, C.WILTED_ATK_FACTOR)
        self.battle = B.start(creature, B.boss_for_tier(self.game.tier or 1))
        self.next_turn_at = now + C.BATTLE_TURN_SECONDS
        self.move_ready_at = now + 0.5
        self.move_deadline = now + C.PLAYER_MOVE_TIMEOUT_SECONDS

    def _after_turn(self, now: float) -> list:
        self.next_turn_at = now + C.BATTLE_TURN_SECONDS
        self.move_ready_at = now + C.BATTLE_TURN_SECONDS  # time for the client to show the turn
        self.move_deadline = now + C.PLAYER_MOVE_TIMEOUT_SECONDS
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

    def _finish_battle(self, won: bool, now: float) -> list:
        demo = self.game.source == C.SOURCE_DEMO
        tier = self.game.tier or 1
        new, plant = S.on_battle_done(self.game, won, now)
        self._set(new)
        if won:
            self.health = min(100.0, self.health + C.HEALTH_WIN_BONUS)
        if plant is None:
            return []
        if self.game.stale:
            log.info("reward for %s blocked, ESP32 offline", plant)
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
        left = max(0.0, self.move_deadline - (self._last_tick or 0.0))
        return {
            "turn": b.turn,
            "creature": b.creature.name,
            "creature_hp": b.creature_hp,
            "creature_max_hp": b.creature.hp,
            "boss_hp": b.boss_hp,
            "last_move": b.last_move,
            "skill": None if skill is None else {
                "name": skill["name"],
                "ready": b.skill_ready_in == 0,
                "ready_in": b.skill_ready_in,
            },
            "manual": self.manual,
            "awaiting_move": self.manual and B.winner(b) is None,
            "move_seconds_left": int(left + 0.999) if self.manual else None,
        }

    def snapshot(self) -> dict:
        g, b = self.game, self.battle
        boss_stats = b.boss if b else B.boss_for_tier(g.tier or 1)
        return {
            "creatures": {p: self.pads[p] or None for p in C.PLANTS},
            "meters": {
                "water": {p: round(self.soil_pct[p], 1) for p in C.PLANTS},
                "sunlight": {p: None for p in C.PLANTS},
                "stale": g.stale,
            },
            "mode": g.mode,
            "health": round(self.health, 1),
            "condition": self.condition(),
            "tier": self.moisture_tier(),
            "boss": None if g.boss_plant is None else {
                "plant": g.boss_plant,
                "name": boss_stats.name,
                "tier": g.tier,
                "hp": b.boss_hp if b else boss_stats.hp,
                "max_hp": boss_stats.hp,
                "type": "drought",
                "source": g.source,
            },
            "battle": None if b is None else self._battle_snapshot(b),
            "reward": self.last_reward,
        }
