"""Turn-based battle. Pure: no clock, no I/O, the random generator is passed in.

Rule in one sentence: each turn you and the boss pick attack, guard or special; attack beats
special, special beats guard, guard beats attack; the winner of the turn hits for its attack
stat, and a tie does nothing.

The boss decides its move one turn ahead (`boss_next`, never shown to anyone). On most turns it
shows that move as its intent; on the others the intent is "?". A shown intent is always the move
the boss will really play. Its moves stay uniformly random, so ignoring the intent gives the same
odds as a boss that shows nothing.

Blooms: every turn you win adds a bloom (up to BLOOM_MAX). A hit from the boss wipes them. The
skill spends them all: each bloom makes the skill BLOOM_BONUS stronger.

Each creature also has one signature skill. A skill always works, then needs a few turns to
recharge. The plants fight as a team of two: when the one in the fight faints, the next one on the
bench steps in at full strength. The fight is lost only when nobody is left."""
import json
import math
import os
import random
from dataclasses import dataclass, replace
from typing import Optional

import config as C

MOVES = ("attack", "guard", "special")
SKILL = "skill"
PLAYER_MOVES = MOVES + (SKILL,)
BEATS = {"attack": "special", "special": "guard", "guard": "attack"}   # key beats value
COUNTER = {loser: winner for winner, loser in BEATS.items()}          # the move that beats key


@dataclass(frozen=True)
class Stats:
    name: str = "Sprout"
    hp: int = C.DEFAULT_CREATURE_HP
    atk: int = C.DEFAULT_CREATURE_ATK
    skill: str = C.DEFAULT_CREATURE_SKILL  # a key of config.SKILLS, or "" for none


def plant_fighter(plant: str) -> Stats:
    """The plant's own fighting numbers, from config.PLANT_FIGHTERS."""
    return Stats(**C.PLANT_FIGHTERS[plant]) if plant in C.PLANT_FIGHTERS else Stats()


def boss_for_tier(tier: int) -> Stats:
    name, hp, atk = C.BOSS_TIERS[min(max(tier, 1), max(C.BOSS_TIERS))]
    return Stats(name=name, hp=hp, atk=atk, skill="")


def show_rate_for_tier(tier: int) -> float:
    return C.INTENT_SHOW_RATE[min(max(tier, 1), max(C.INTENT_SHOW_RATE))]


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
    plant: str = ""          # which plant is fighting right now ("" when it is not a plant)
    bench: tuple = ()        # (plant, Stats) pairs still waiting to step in, in order
    fallen: tuple = ()       # (plant, Stats) pairs that have fainted in this fight
    blooms: int = 0          # 0..BLOOM_MAX, spent by the skill
    show_rate: float = 0.0   # chance the boss shows its next move
    intent: Optional[str] = None   # the boss's next move when it shows it, None for "?"
    boss_next: str = ""      # SECRET: the boss's real next move. Never serialize this.


def load_creatures(path: str = C.CREATURES_FILE) -> dict:
    """tag UID -> Stats. Missing file means everything uses the default stats."""
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        raw = json.load(f)
    return {uid: Stats(**s) for uid, s in raw.items() if not uid.startswith("_")}


def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def skill_of(stats: Stats) -> Optional[dict]:
    return C.SKILLS.get(stats.skill)


def skill_kind(skill: dict) -> str:
    if skill.get("block"):
        return "shield"
    if skill.get("heal"):
        return "heal"
    return "damage"


def bloom_factor(blooms: int) -> float:
    return 1.0 + C.BLOOM_BONUS * blooms


def skill_power(b: Battle) -> int:
    """What the skill would do if used now: damage dealt (damage, shield) or HP healed (heal).
    The heal is the full amount; on the turn it is capped at the creature's missing HP."""
    skill = skill_of(b.creature)
    if skill is None:
        return 0
    k = bloom_factor(b.blooms)
    if skill_kind(skill) == "heal":
        return round_half_up(skill["heal"] * k)
    return round_half_up(b.creature.atk * skill.get("damage_factor", 0) * k)


def start(creature: Stats, boss: Stats = BOSS_STATS, plant: str = "", bench: tuple = (),
          show_rate: float = 0.0) -> Battle:
    """A new fight. Roll the boss's first move with roll_intent() before the first turn
    (play_turn does it if you forget)."""
    return Battle(creature, boss, creature.hp, boss.hp, plant=plant, bench=tuple(bench),
                  show_rate=show_rate)


def roll_intent(b: Battle, rng: random.Random, show_rate: Optional[float] = None) -> Battle:
    """The boss picks its next move, uniformly, and shows it with probability show_rate."""
    rate = b.show_rate if show_rate is None else show_rate
    move = rng.choice(MOVES)
    shown = rng.random() < rate
    return replace(b, boss_next=move, intent=move if shown else None)


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
    if creature_move not in MOVES and not use_skill:
        creature_move = "attack"

    c_hp, b_hp, who = b.creature_hp, b.boss_hp, "tie"
    damage = heal = taken = 0
    blooms = b.blooms
    spent = gain = 0
    log = {"creature": creature_move, "boss": boss_move}

    if use_skill:
        power = skill_power(b)
        kind = skill_kind(skill)
        damage = 0 if kind == "heal" else power
        heal = min(power, b.creature.hp - c_hp) if kind == "heal" else 0
        c_hp += heal
        who = "creature" if damage else "none"
        # Only a shield protects. With any other skill an attacking boss still lands its hit.
        if boss_move == "attack" and kind != "shield":
            taken = b.boss.atk
            who = "both" if damage else "boss"
        spent, blooms = blooms, 0
        log["skill"] = skill["name"]
    elif BEATS[creature_move] == boss_move:
        damage, who = b.creature.atk, "creature"
        gain = 1 if blooms < C.BLOOM_MAX else 0
        blooms += gain
    elif BEATS[boss_move] == creature_move:
        taken, who = b.boss.atk, "boss"
        gain, blooms = -blooms, 0

    dealt = min(damage, b_hp)
    taken = min(taken, c_hp)
    b_hp -= dealt
    c_hp -= taken
    log.update(hit=who, dealt=dealt, taken=taken, healed=heal, blooms_spent=spent, bloom_gain=gain)
    ready_in = C.SKILL_COOLDOWN_TURNS if use_skill else max(0, b.skill_ready_in - 1)
    b = replace(b, creature_hp=c_hp, boss_hp=b_hp, turn=b.turn + 1, last_move=log,
                skill_ready_in=ready_in, blooms=blooms)
    return _send_in_next(b)


def _send_in_next(b: Battle) -> Battle:
    """The fighter fainted and the boss still stands: the next plant on the bench steps in."""
    if b.creature_hp > 0 or b.boss_hp <= 0 or not b.bench:
        return b
    (plant, stats), rest = b.bench[0], b.bench[1:]
    log = dict(b.last_move, swap={"out": b.plant, "in": plant, "name": stats.name})
    return replace(b, creature=stats, creature_hp=stats.hp, plant=plant, bench=rest,
                   fallen=b.fallen + ((b.plant, b.creature),), skill_ready_in=0, blooms=0,
                   last_move=log)


def heal_worth_it(b: Battle) -> bool:
    """A heal is only used when most of it would land (never at full HP)."""
    missing = b.creature.hp - b.creature_hp
    return missing > 0 and missing >= C.AUTOPILOT_HEAL_MIN_SHARE * skill_power(b)


def skill_finishes(b: Battle) -> bool:
    skill = skill_of(b.creature)
    return skill is not None and skill_kind(skill) != "heal" and skill_power(b) >= b.boss_hp


def auto_move(b: Battle, rng: random.Random, read_chance: float = None) -> str:
    """The move the game picks for an absent player. Uses public information only.
    a) the skill if it is ready and finishes the boss (unless a shown Attack would hit back
       and the skill does not block);
    b) the skill if it is ready, the intent is hidden and at least one bloom is banked
       (a heal only when most of it would land);
    c) otherwise counter a shown intent, some of the time;
    d) otherwise a random move."""
    if read_chance is None:
        read_chance = C.AUTOPILOT_READ_CHANCE
    skill = skill_of(b.creature)
    ready = skill is not None and b.skill_ready_in == 0
    if ready and skill_finishes(b) and not (b.intent == "attack" and skill_kind(skill) != "shield"):
        return SKILL
    if ready and b.intent is None and b.blooms >= 1:
        if skill_kind(skill) != "heal" or heal_worth_it(b):
            return SKILL
    if b.intent is not None and rng.random() < read_chance:
        return COUNTER[b.intent]
    return rng.choice(MOVES)


def play_turn(b: Battle, rng: random.Random, creature_move: Optional[str] = None) -> Battle:
    """One turn against the boss's pre-rolled move. With no creature_move the game picks one.
    Afterwards the boss rolls its next move, unless the fight is over."""
    if not b.boss_next:
        b = roll_intent(b, rng)
    if creature_move is None:
        creature_move = auto_move(b, rng)
    b = resolve_turn(b, creature_move, b.boss_next)
    if winner(b) is None:
        b = roll_intent(b, rng)
    else:
        b = replace(b, intent=None, boss_next="")
    return b
