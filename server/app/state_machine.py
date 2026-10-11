# server/app/state_machine.py: Per-pot game state (ok, boss, watering) and the rules that move between them. Owner: Role 2 (server).
"""Pure game logic. No I/O: the caller feeds events in and sends out the returned commands.

Commands are tuples: ("pump", "A", ms) or ("light", minutes).
"""
from __future__ import annotations

import json
from collections import deque
from typing import List, Optional, Tuple

import config
from . import battle, rewards
from .models import BossConfig, CreatureProfile, Pot

Command = Tuple


def load_boss() -> BossConfig:
    try:
        raw = json.loads((config.DATA_DIR / "boss.json").read_text())
    except (OSError, ValueError):
        raw = {}
    fields = {k: raw[k] for k in BossConfig.__dataclass_fields__ if k in raw}
    return BossConfig(**fields)


def load_creatures() -> dict:
    try:
        return json.loads((config.DATA_DIR / "creatures.json").read_text())
    except (OSError, ValueError):
        return {"default": {"name": "Sprout", "hp": 30, "attack": 6, "color": "#6ccf5a"}, "uids": {}}


def water_fraction(pot_id: str, raw: Optional[int]) -> Optional[float]:
    """0.0 = bone dry, 1.0 = fully wet, from the calibration numbers."""
    if raw is None:
        return None
    cal = config.SOIL[pot_id]
    span = cal["air"] - cal["water"]
    return max(0.0, min(1.0, (cal["air"] - raw) / span)) if span else None


class Game:
    def __init__(self, boss: Optional[BossConfig] = None, creatures: Optional[dict] = None,
                 progress: Optional[dict] = None, clock=None):
        self.boss = boss or load_boss()
        self.creature_db = creatures if creatures is not None else load_creatures()
        self.xp = dict(progress or {})
        self.pots = {"A": Pot("A"), "B": Pot("B")}
        self.esp32 = "unknown"
        self.sunlight: Optional[float] = None     # 0-100, from the camera
        self.light_until = 0.0
        self.last_light_cmd = -1e9
        self.events = deque(maxlen=config.EVENT_LOG_SIZE)
        self.progress_dirty = False
        self._now = 0.0

    # ---- helpers --------------------------------------------------------
    def _log(self, pot: Optional[str], kind: str, text: str) -> None:
        self.events.append({"t": round(self._now, 1), "pot": pot, "kind": kind, "text": text})

    def _profile_for(self, uid: str) -> CreatureProfile:
        spec = self.creature_db.get("uids", {}).get(uid) or self.creature_db["default"]
        return CreatureProfile(uid=uid, name=spec["name"], base_hp=int(spec["hp"]),
                               base_attack=int(spec["attack"]), color=spec.get("color", "#6ccf5a"),
                               xp=int(self.xp.get(uid, 0)))

    # ---- inputs ---------------------------------------------------------
    def on_pad(self, pot_id: str, uid: str, now: float) -> None:
        self._now = now
        pot = self.pots[pot_id]
        uid = uid.strip().upper().replace(":", "").replace(" ", "")
        if not uid:
            if pot.creature:
                self._log(pot_id, "pad", f"{pot.creature.name} left pot {pot_id}")
            pot.creature = None
            return
        if pot.creature and pot.creature.uid == uid:
            return
        pot.creature = self._profile_for(uid)
        pot.creature_hp = pot.creature.max_hp
        self._log(pot_id, "pad", f"{pot.creature.name} (Lv{pot.creature.level}) joined pot {pot_id}")

    def on_soil(self, pot_id: str, raw: int, now: float) -> None:
        self._now = now
        pot = self.pots[pot_id]
        cal = config.SOIL[pot_id]
        pot.soil_raw, pot.soil_time = raw, now
        if raw >= cal["dry_at"]:
            pot.dry = True
        elif raw <= cal["wet_at"]:
            pot.dry = False
            if pot.phase == "boss":                       # somebody watered by hand
                battle.end_battle(pot)
                pot.phase = "ok"
                self._log(pot_id, "boss", f"Pot {pot_id} got wet. The boss fled")
            elif pot.phase == "watering":
                pot.phase = "ok"
                self._log(pot_id, "water", f"Pot {pot_id} is happy again")

    def on_esp32(self, status: str, now: float) -> None:
        self._now = now
        status = status.strip().lower()
        if status != self.esp32:
            self.esp32 = status
            self._log(None, "esp32", f"Cube is {status}")

    def on_sunlight(self, percent: Optional[float]) -> None:
        self.sunlight = percent

    def force_boss(self, pot_id: str, now: float) -> bool:
        """Debug override: summon the boss on a pot regardless of soil."""
        self._now = now
        pot = self.pots[pot_id]
        if pot.phase == "boss":
            return False
        battle.start_battle(pot, self.boss)
        self._log(pot_id, "boss", f"[debug] {self.boss.name} summoned on pot {pot_id}")
        return True

    # ---- time -----------------------------------------------------------
    def tick(self, now: float, dt: float) -> List[Command]:
        self._now = now
        cmds: List[Command] = []
        for pot_id, pot in self.pots.items():
            if pot.soil_raw is not None and now - pot.soil_time > config.SOIL_STALE_SECONDS:
                pot.soil_raw = None                       # stale: show unknown, keep latch
            if pot.phase == "ok" and pot.dry:
                battle.start_battle(pot, self.boss)
                self._log(pot_id, "boss", f"{self.boss.name} appears at pot {pot_id}!")
            elif pot.phase == "watering" and now >= pot.settle_until:
                pot.phase = "ok"                          # still dry -> next tick summons again
            if battle.step(pot, self.boss, dt) == "won":
                level_up = rewards.grant_win(pot.creature, self.boss)
                self.xp[pot.creature.uid] = pot.creature.xp
                self.progress_dirty = True
                battle.end_battle(pot)
                pot.phase = "watering"
                pot.settle_until = now + config.WATER_SETTLE_SECONDS
                cmds.append(("pump", pot_id, config.PUMP_MS))
                self._log(pot_id, "win", f"{pot.creature.name} beat the boss! Watering pot {pot_id}"
                          + (" (LEVEL UP!)" if level_up else ""))
        if self.light_until and now >= self.light_until:
            self.light_until = 0.0
        return cmds

    def maybe_auto_light(self, now: float) -> List[Command]:
        if not (config.AUTO_LIGHT and self.sunlight is not None):
            return []
        if self.sunlight < config.LIGHT_LOW_PERCENT and now - self.last_light_cmd > config.LIGHT_COOLDOWN_SECONDS:
            self.last_light_cmd = now
            self.light_until = now + config.LIGHT_MINUTES * 60
            self._log(None, "light", f"Dark in here: grow light on for {config.LIGHT_MINUTES} min")
            return [("light", config.LIGHT_MINUTES)]
        return []

    # ---- output ---------------------------------------------------------
    def snapshot(self, now: float) -> dict:
        pots = {}
        for pot_id, pot in self.pots.items():
            c = pot.creature
            pots[pot_id] = {
                "creature": None if not c else {
                    "uid": c.uid, "name": c.name, "level": c.level, "xp": c.xp % 100,
                    "hp": pot.creature_hp, "max_hp": c.max_hp, "attack": c.attack, "color": c.color},
                "soil_raw": pot.soil_raw,
                "water": water_fraction(pot_id, pot.soil_raw),
                "dry": pot.dry,
                "phase": pot.phase,
                "boss": None if pot.phase != "boss" else {
                    "name": self.boss.name, "hp": pot.boss_hp, "max_hp": self.boss.hp},
                "last_hit": pot.last_hit,
            }
        return {
            "t": round(now, 1),
            "esp32": self.esp32,
            "sunlight": self.sunlight,
            "light_on": self.light_until > now,
            "pots": pots,
            "events": list(self.events),
        }
