# server/app/battle.py: Turn-based boss fight rules. Owner: Role 2 (server).
from __future__ import annotations

from .models import BossConfig, Pot


def start_battle(pot: Pot, boss: BossConfig) -> None:
    pot.phase = "boss"
    pot.boss_hp = boss.hp
    pot.round_timer = 0.0
    pot.last_hit = {}
    if pot.creature:
        pot.creature_hp = pot.creature.max_hp


def end_battle(pot: Pot) -> None:
    pot.boss_hp = 0
    pot.round_timer = 0.0
    pot.last_hit = {}


def step(pot: Pot, boss: BossConfig, dt: float) -> str:
    """Advance a boss fight by dt seconds.

    The fight only runs while a creature stands on the pad. The creature never
    drops below 1 HP, so a fight always ends in a win (the demo must not stall).
    Returns "won" when the boss is beaten, otherwise "".
    """
    if pot.phase != "boss" or pot.creature is None:
        return ""
    pot.round_timer += dt
    while pot.round_timer >= boss.round_seconds:
        pot.round_timer -= boss.round_seconds
        dmg = pot.creature.attack
        pot.boss_hp = max(0, pot.boss_hp - dmg)
        pot.last_hit = {"by": "creature", "dmg": dmg}
        if pot.boss_hp == 0:
            return "won"
        pot.creature_hp = max(1, pot.creature_hp - boss.attack)
        pot.last_hit = {"by": "boss", "dmg": boss.attack}
    return ""
