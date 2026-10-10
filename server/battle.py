"""Turn-based battle. The player picks each move.

Rule in one sentence: each turn you and the boss pick attack, guard or special; attack beats
special, special beats guard, guard beats attack; the winner of the turn hits for its attack
stat, and a tie does nothing.

Each creature also has one signature skill. A skill always works, then needs a few turns to
recharge.

Placeholder rules until the original game's numbers are confirmed with the team."""
import json
import os
import random
from dataclasses import dataclass, replace
from typing import Optional

import config as C

MOVES = ("attack", "guard", "special")
SKILL = "skill"
PLAYER_MOVES = MOVES + (SKILL,)
BEATS = {"attack": "special", "special": "guard", "guard": "attack"}


@dataclass(frozen=True)
class Stats:
    name: str = "Sprout"
    hp: int = C.DEFAULT_CREATURE_HP
    atk: int = C.DEFAULT_CREATURE_ATK
    skill: str = C.DEFAULT_CREATURE_SKILL  # a key of config.SKILLS, or "" for none


def boss_for_tier(tier: int) -> Stats:
    name, hp, atk = C.BOSS_TIERS[min(max(tier, 1), max(C.BOSS_TIERS))]
    return Stats(name=name, hp=hp, atk=atk, skill="")


BOSS_STATS = boss_for_tier(1)


@dataclass(frozen=True)
class Battle:
    creature: Stats
    boss: Stats
    creature_hp: int
    boss_hp: int
    turn: int = 0
    last_move: Optional[dict] = None
    skill_ready_in: int = 0  # turns until the creature's skill can be used again


def load_creatures(path: str = C.CREATURES_FILE) -> dict:
    """tag UID -> Stats. Missing file means everything uses the default stats."""
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        raw = json.load(f)
    return {uid: Stats(**s) for uid, s in raw.items() if not uid.startswith("_")}


def weakened(stats: Stats, atk_factor: float) -> Stats:
    """A wilted plant hits weaker. Its attack never drops below 1."""
    return replace(stats, atk=max(1, round(stats.atk * atk_factor)))


def skill_of(stats: Stats) -> Optional[dict]:
    return C.SKILLS.get(stats.skill)


def start(creature: Stats, boss: Stats = BOSS_STATS) -> Battle:
    return Battle(creature, boss, creature.hp, boss.hp)


def winner(b: Battle) -> Optional[str]:
    if b.boss_hp <= 0:
        return "creature"
    if b.creature_hp <= 0:
        return "boss"
    return None


def resolve_turn(b: Battle, creature_move: str, boss_move: str) -> Battle:
    skill = skill_of(b.creature)
    use_skill = creature_move == SKILL and skill is not None and b.skill_ready_in == 0
    if creature_move == SKILL and not use_skill:
        creature_move = "attack"  # skill not ready (or none): it becomes a plain attack

    c_hp, b_hp, who = b.creature_hp, b.boss_hp, "tie"
    log = {"creature": creature_move, "boss": boss_move}

    if use_skill:
        damage = round(b.creature.atk * skill.get("damage_factor", 0))
        heal = min(skill.get("heal", 0), b.creature.hp - c_hp)
        b_hp -= damage
        c_hp += heal
        who = "creature" if damage else "none"
        # Only a shield protects. With any other skill an attacking boss still lands its hit.
        if boss_move == "attack" and not skill.get("block"):
            c_hp -= b.boss.atk
            who = "both" if damage else "boss"
        log.update(skill=skill["name"], damage=damage, healed=heal)
    elif BEATS[creature_move] == boss_move:
        b_hp, who = b_hp - b.creature.atk, "creature"
    elif BEATS[boss_move] == creature_move:
        c_hp, who = c_hp - b.boss.atk, "boss"

    log["hit"] = who
    ready_in = C.SKILL_COOLDOWN_TURNS if use_skill else max(0, b.skill_ready_in - 1)
    return replace(b, creature_hp=max(0, c_hp), boss_hp=max(0, b_hp),
                   turn=b.turn + 1, last_move=log, skill_ready_in=ready_in)


def auto_move(b: Battle, rng: random.Random) -> str:
    """The move the game picks when the player does not: the skill when ready, else a random move."""
    if b.skill_ready_in == 0 and skill_of(b.creature) is not None:
        return SKILL
    return rng.choice(MOVES)


def play_turn(b: Battle, rng: random.Random, creature_move: Optional[str] = None) -> Battle:
    """One turn. The boss always picks at random. With no creature_move the game picks one."""
    if creature_move is None:
        creature_move = auto_move(b, rng)
    return resolve_turn(b, creature_move, rng.choice(MOVES))
