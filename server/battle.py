"""Turn-based battle. Rule in one sentence: each turn both sides pick attack, guard or
special; attack beats special, special beats guard, guard beats attack; the turn's winner
hits for its attack stat and a tie does nothing.

Placeholder rules until the original game's numbers are confirmed with the team."""
import json
import os
import random
from dataclasses import dataclass, replace
from typing import Optional

import config as C

MOVES = ("attack", "guard", "special")
BEATS = {"attack": "special", "special": "guard", "guard": "attack"}


@dataclass(frozen=True)
class Stats:
    name: str = "Sprout"
    hp: int = C.DEFAULT_CREATURE_HP
    atk: int = C.DEFAULT_CREATURE_ATK


def boss_for_tier(tier: int) -> Stats:
    name, hp, atk = C.BOSS_TIERS[min(max(tier, 1), max(C.BOSS_TIERS))]
    return Stats(name=name, hp=hp, atk=atk)


BOSS_STATS = boss_for_tier(1)


@dataclass(frozen=True)
class Battle:
    creature: Stats
    boss: Stats
    creature_hp: int
    boss_hp: int
    turn: int = 0
    last_move: Optional[dict] = None


def load_creatures(path: str = C.CREATURES_FILE) -> dict:
    """tag UID -> Stats. Missing file means everything uses the default stats."""
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        raw = json.load(f)
    return {uid: Stats(**s) for uid, s in raw.items()}


def start(creature: Stats, boss: Stats = BOSS_STATS) -> Battle:
    return Battle(creature, boss, creature.hp, boss.hp)


def winner(b: Battle) -> Optional[str]:
    if b.boss_hp <= 0:
        return "creature"
    if b.creature_hp <= 0:
        return "boss"
    return None


def resolve_turn(b: Battle, creature_move: str, boss_move: str) -> Battle:
    c_hp, b_hp, who = b.creature_hp, b.boss_hp, "tie"
    if BEATS[creature_move] == boss_move:
        b_hp, who = b_hp - b.creature.atk, "creature"
    elif BEATS[boss_move] == creature_move:
        c_hp, who = c_hp - b.boss.atk, "boss"
    log = {"creature": creature_move, "boss": boss_move, "hit": who}
    return replace(b, creature_hp=max(0, c_hp), boss_hp=max(0, b_hp),
                   turn=b.turn + 1, last_move=log)


def play_turn(b: Battle, rng: random.Random) -> Battle:
    return resolve_turn(b, rng.choice(MOVES), rng.choice(MOVES))
