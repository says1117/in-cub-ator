"""Turn-based battle. The player picks each move.

Rule in one sentence: the boss shows the move it is winding up and how sure that is; each turn
you and the boss use attack, guard or special; attack beats special, special beats guard, guard
beats attack; the winner of the turn hits for its attack stat, and a tie costs the plant a
little.

Each creature also has one signature skill. Turns won with a plain move charge it. A charged
skill lands whatever the boss does, then empties.

The plants fight as a team of two: when the one in the fight faints, the next one on the bench
steps in at full strength with its skill charged. The fight is lost only when nobody is left."""
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
BEATEN_BY = {loser: winner for winner, loser in BEATS.items()}  # the move that beats this one


@dataclass(frozen=True)
class Stats:
    name: str = "Sprout"
    hp: int = C.DEFAULT_CREATURE_HP
    atk: int = C.DEFAULT_CREATURE_ATK
    skill: str = C.DEFAULT_CREATURE_SKILL  # a key of config.SKILLS, or "" for none
    plant_id: str = ""     # the plant database id, "" for the old pad defaults and bosses
    moves: tuple = ()      # (category, move_id, power) for each category, () for the old defaults


def plant_fighter(plant: str) -> Stats:
    """The plant's own fighting numbers, from config.PLANT_FIGHTERS."""
    return Stats(**C.PLANT_FIGHTERS[plant]) if plant in C.PLANT_FIGHTERS else Stats()


def clamp_tier(tier: int) -> int:
    return min(max(tier, 1), max(C.BOSS_TIERS))


def boss_for_tier(tier: int) -> Stats:
    name, hp, atk = C.BOSS_TIERS[clamp_tier(tier)]
    return Stats(name=name, hp=hp, atk=atk, skill="")


@dataclass(frozen=True)
class Battle:
    creature: Stats
    boss: Stats
    creature_hp: int
    boss_hp: int
    turn: int = 0
    last_move: Optional[dict] = None
    charge: int = 0          # turns won towards the creature's skill
    plant: str = ""          # which plant is fighting right now ("" when it is not a plant)
    bench: tuple = ()        # (plant, Stats) pairs still waiting to step in, in order
    fallen: tuple = ()       # (plant, Stats) pairs that have fainted in this fight
    battle_id: str = ""      # unique per fight, so XP is paid once per fight
    tier: int = 1            # which boss this is: decides how honest its tells are
    enraged: bool = False    # true once the boss is at half health or less
    intent: Optional[dict] = None  # the tell for the coming turn: what the boss shows
    boss_next: str = ""      # what the boss will really do. Never sent to the screen.
    seen: tuple = ()         # the player's last plain moves, newest last


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


def skill_ready(b: Battle) -> bool:
    return skill_of(b.creature) is not None and b.charge >= C.SKILL_CHARGE_NEED


def start(creature: Stats, boss: Optional[Stats] = None, plant: str = "", bench: tuple = (),
          tier: int = 1, charge: int = C.SKILL_CHARGE_START,
          rng: Optional[random.Random] = None, battle_id: str = "") -> Battle:
    """A new fight. With an rng the boss's first tell is rolled straight away."""
    tier = clamp_tier(tier)
    boss = boss or boss_for_tier(tier)
    b = Battle(creature, boss, creature.hp, boss.hp, plant=plant, bench=tuple(bench),
               tier=tier, charge=charge, battle_id=battle_id)
    return plan(b, rng) if rng is not None else b


def move_of(stats: Stats, category: str) -> tuple:
    """(move_id, power) for a category. Plants without a moveset (the old defaults) use ("", 100)."""
    for cat, move_id, power in stats.moves:
        if cat == category:
            return move_id, power
    return "", 100


def category_of(stats: Stats, move: str) -> Optional[str]:
    """A player move as a category: "attack" stays "attack", and a plant's own move id (for example
    "ember-jab") becomes its category. None if the plant does not have that move."""
    if move in PLAYER_MOVES:
        return move
    for cat, move_id, _ in stats.moves:
        if move_id == move:
            return cat
    return None


def _scaled(value: float, power: int) -> int:
    """Damage for a move's power. Exactly the old number at power 100, so balance does not move."""
    return round(value) if power == 100 else round(value * power / 100)


def winner(b: Battle) -> Optional[str]:
    if b.boss_hp <= 0:
        return "creature"
    if b.creature_hp <= 0:
        return "boss"
    return None


def plan(b: Battle, rng: random.Random) -> Battle:
    """The boss picks its real move for the coming turn and the tell it shows for it."""
    every = C.HEAVY_EVERY[b.tier]
    heavy = bool(every) and (b.turn + 1) % every == 0
    shown = rng.choice(MOVES)
    s = b.seen
    if len(s) >= 2 and s[-1] == s[-2] and rng.random() < C.ANTI_REPEAT[b.tier]:
        shown = BEATEN_BY[s[-1]]  # it has seen that move twice running: it answers it
    phase = "enraged" if b.enraged else "calm"
    if heavy:
        grade = C.HEAVY_GRADE[b.tier][phase]
    else:
        mix = C.TELL_MIX[b.tier][phase]
        grade = rng.choices(list(mix), weights=list(mix.values()))[0]
    chance = C.TELL_CHANCE[grade]
    # A bluff punishes the natural counter: it shows attack, you guard, it uses special.
    real = shown if rng.random() < chance else BEATS[shown]
    intent = {"move": shown, "grade": grade, "chance": chance, "heavy": heavy,
              "bluff": None if chance >= 1 else BEATS[shown]}
    return replace(b, intent=intent, boss_next=real)


def plain_hit(b: Battle) -> int:
    """A plain boss hit: its attack, plus the bonus once it is enraged."""
    return b.boss.atk + (C.ENRAGE_ATK_BONUS[b.tier] if b.enraged else 0)


def boss_hit(b: Battle, boss_move: str) -> int:
    """What a landed boss move takes. Heavy and bluff hits are bigger. They never stack."""
    factor = 1.0
    if b.intent:
        if b.intent["heavy"]:
            factor = max(factor, C.HEAVY_FACTOR)
        if boss_move != b.intent["move"]:
            factor = max(factor, C.BLUFF_FACTOR)
    return min(C.BOSS_HIT_CAP, int(plain_hit(b) * factor + 0.5))


def clash_hit(b: Battle) -> int:
    return int(plain_hit(b) * C.CLASH_SHARE)


def resolve_turn(b: Battle, creature_move: str, boss_move: str) -> Battle:
    skill = skill_of(b.creature)
    use_skill = creature_move == SKILL and skill_ready(b)
    if creature_move == SKILL and not use_skill:
        creature_move = "attack"  # skill not charged (or none): it becomes a plain attack

    c_hp, b_hp, who, charge, seen = b.creature_hp, b.boss_hp, "tie", b.charge, b.seen
    shown = b.intent["move"] if b.intent else boss_move
    log = {"creature": creature_move, "boss": boss_move, "shown": shown,
           "bluffed": boss_move != shown, "heavy": bool(b.intent and b.intent["heavy"])}
    took = 0  # what the plant loses this turn

    move_id, power = move_of(b.creature, SKILL if use_skill else creature_move)
    if move_id:
        log["move_id"] = move_id
    if b.creature.plant_id:
        # Who made this move, recorded now: the plant may later be swapped out or lifted.
        log["actor_pad"] = b.plant
        log["actor_plant_id"] = b.creature.plant_id
    if use_skill:
        damage = _scaled(b.creature.atk * skill.get("damage_factor", 0), power)
        heal = min(skill.get("heal", 0), b.creature.hp - c_hp)
        b_hp -= damage
        c_hp += heal
        who = "creature" if damage else "none"
        # Only a shield protects. With any other skill an attacking boss still lands its hit.
        if boss_move == "attack" and not skill.get("block"):
            took = boss_hit(b, boss_move)
            who = "both" if damage else "boss"
        charge = 0
        log.update(skill=skill["name"], damage=damage, healed=heal)
    else:
        if BEATS[creature_move] == boss_move:
            damage = _scaled(b.creature.atk, power)
            b_hp, who = b_hp - damage, "creature"
            charge = min(C.SKILL_CHARGE_NEED, charge + 1)
            log["damage"] = damage
        elif BEATS[boss_move] == creature_move:
            took, who = boss_hit(b, boss_move), "boss"
        else:
            took = clash_hit(b)  # a tie: the two moves meet and the plant is grazed
        seen = (seen + (creature_move,))[-2:]

    c_hp -= took
    log.update(hit=who, took=took)
    b = replace(b, creature_hp=max(0, c_hp), boss_hp=max(0, b_hp), turn=b.turn + 1,
                last_move=log, charge=charge, seen=seen, intent=None, boss_next="")
    if not b.enraged and 0 < b.boss_hp <= b.boss.hp * C.ENRAGE_AT:
        b = replace(b, enraged=True, last_move=dict(b.last_move, enraged=True))
    return _send_in_next(b)


def _send_in_next(b: Battle) -> Battle:
    """The fighter fainted and the boss still stands: the next plant on the bench steps in."""
    if b.creature_hp > 0 or b.boss_hp <= 0 or not b.bench:
        return b
    (plant, stats), rest = b.bench[0], b.bench[1:]
    log = dict(b.last_move, swap={"out": b.plant, "in": plant, "name": stats.name})
    # The fresh plant arrives with its skill charged: that is the comeback.
    return replace(b, creature=stats, creature_hp=stats.hp, plant=plant, bench=rest,
                   fallen=b.fallen + ((b.plant, b.creature),), charge=C.SKILL_CHARGE_NEED,
                   seen=(), last_move=log)


def withdraw(b: Battle, plant: str) -> Optional[Battle]:
    """A plant was lifted off its pad during the fight. On the bench it just leaves. If it was the
    one fighting, the next plant on the bench steps in at full strength. Returns None when nobody
    is left to fight (the battle is cancelled: no win, no water, no XP)."""
    if any(p == plant for p, _ in b.bench):
        return replace(b, bench=tuple((p, s) for p, s in b.bench if p != plant))
    if plant != b.plant:
        return b  # not in this fight (or already fainted)
    if not b.bench:
        return None
    (nxt, stats), rest = b.bench[0], b.bench[1:]
    log = dict(b.last_move or {}, swap={"out": b.plant, "in": nxt, "name": stats.name, "reason": "lifted"})
    # Like a faint: the fresh plant arrives with its skill charged.
    return replace(b, creature=stats, creature_hp=stats.hp, plant=nxt, bench=rest,
                   charge=C.SKILL_CHARGE_NEED, seen=(), last_move=log)


def auto_move(b: Battle, rng: random.Random) -> str:
    """The move the game picks when the player does not: it believes the tell. It counters the
    shown move, and uses a charged skill unless the boss shows an attack."""
    shown = b.intent["move"] if b.intent else rng.choice(MOVES)
    if skill_ready(b) and shown != "attack":
        return SKILL
    return BEATEN_BY[shown]


def play_turn(b: Battle, rng: random.Random, creature_move: Optional[str] = None) -> Battle:
    """One turn against the tell already shown, then the boss winds up the next one.
    With no creature_move the game picks one."""
    if b.intent is None:
        b = plan(b, rng)
    if creature_move is None:
        creature_move = auto_move(b, rng)
    b = resolve_turn(b, creature_move, b.boss_next)
    return plan(b, rng) if winner(b) is None else b
