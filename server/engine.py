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

    def _set(self, new: S.Game):
        if new.mode != self.game.mode:
            log.info("mode %s -> %s (boss=%s forced=%s)", self.game.mode, new.mode,
                     new.boss_plant, new.forced)
        self.game = new

    # inputs -----------------------------------------------------------
    def on_soil_raw(self, plant: str, raw: int, now: float) -> list:
        self.soil_pct[plant] = S.soil_pct(raw)
        self._set(S.on_soil(self.game, plant, self.soil_pct[plant], now))
        return self.tick(now)

    def on_pad(self, plant: str, uid: str):
        self.pads[plant] = uid.strip()

    def on_esp_status(self, text: str):
        self._set(S.on_status(self.game, text.strip() == "online"))

    def on_debug_boss(self, payload: str, now: float) -> list:
        p = payload.strip().upper()
        if p in C.PLANTS:
            self._set(S.on_force(self.game, p, now))
        elif p == "OFF":
            self._set(S.on_force(self.game, None, now))
            self.battle = None
        return self.tick(now)

    # time -------------------------------------------------------------
    def tick(self, now: float) -> list:
        commands = []
        self._set(S.on_tick(self.game, now))

        if self.game.mode == S.BATTLE and self.battle is None:
            uid = self.pads.get(self.game.boss_plant, "")
            self.battle = B.start(self.creatures.get(uid, B.Stats()))
            self.next_turn_at = now + C.BATTLE_TURN_SECONDS

        if self.game.mode == S.BATTLE and now >= self.next_turn_at:
            self.battle = B.play_turn(self.battle, self.rng)
            self.next_turn_at = now + C.BATTLE_TURN_SECONDS
            result = B.winner(self.battle)
            if result:
                commands = self._finish_battle(result == "creature", now)

        if self.game.mode not in (S.BATTLE,) and self.battle and self.game.mode != S.REWARD:
            self.battle = None
        return commands

    def _finish_battle(self, won: bool, now: float) -> list:
        plant = self.game.boss_plant
        forced = self.game.forced
        new, reward_plant = S.on_battle_done(self.game, won, now)
        self._set(new)
        if reward_plant is None:
            return []
        pct = C.DEMO_FAKE_DRY_PCT if forced else self.soil_pct[plant]
        last = float("-inf") if forced else self.last_reward_at[plant]
        cmd = R.water_reward(plant, pct, now, last)
        if cmd is None:
            log.info("reward for %s blocked (soil %.0f%%)", plant, pct)
            return []
        self.last_reward_at[plant] = now
        self.last_reward = {"type": "water", "plant": plant, "size": int(cmd.payload)}
        log.info("command %s %s", cmd.topic, cmd.payload)
        return [cmd]

    # output -----------------------------------------------------------
    def snapshot(self) -> dict:
        g, b = self.game, self.battle
        return {
            "creatures": {p: self.pads[p] or None for p in C.PLANTS},
            "meters": {
                "water": {p: round(self.soil_pct[p], 1) for p in C.PLANTS},
                "sunlight": {p: None for p in C.PLANTS},
                "stale": g.stale,
            },
            "mode": g.mode,
            "boss": None if g.boss_plant is None else {
                "plant": g.boss_plant,
                "hp": b.boss_hp if b else B.BOSS_STATS.hp,
                "max_hp": B.BOSS_STATS.hp,
                "type": "drought",
            },
            "battle": None if b is None else {
                "turn": b.turn,
                "creature_hp": b.creature_hp,
                "creature_max_hp": b.creature.hp,
                "boss_hp": b.boss_hp,
                "last_move": b.last_move,
            },
            "reward": self.last_reward,
        }
