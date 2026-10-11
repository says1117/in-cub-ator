# server/app/models.py: Data classes for creatures, bosses and pots. Owner: Role 2 (server).
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CreatureProfile:
    """Static stats for a tag, plus saved progress."""
    uid: str
    name: str
    base_hp: int
    base_attack: int
    color: str
    xp: int = 0

    @property
    def level(self) -> int:
        return 1 + self.xp // 100

    @property
    def max_hp(self) -> int:
        return self.base_hp + (self.level - 1) * 6

    @property
    def attack(self) -> int:
        return self.base_attack + (self.level - 1) * 2


@dataclass
class BossConfig:
    name: str = "Drought Golem"
    hp: int = 60
    attack: int = 4
    reward_xp: int = 40
    round_seconds: float = 1.2


@dataclass
class Pot:
    """Everything the server knows about one pot (A or B)."""
    id: str
    creature: Optional[CreatureProfile] = None
    soil_raw: Optional[int] = None
    soil_time: float = 0.0
    dry: bool = False                # latched with hysteresis
    phase: str = "ok"                # ok | boss | watering
    boss_hp: int = 0
    creature_hp: int = 0
    round_timer: float = 0.0
    settle_until: float = 0.0
    last_hit: dict = field(default_factory=dict)   # {"by": "creature"|"boss", "dmg": n}
