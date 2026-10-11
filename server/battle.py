"""Turn-based battle. The player picks each move.

Rule in one sentence: the boss shows the move it is winding up and how sure that is; each turn
you and the boss use attack, guard or special; attack beats special, special beats guard, guard
beats attack; the winner of the turn hits for its attack stat, and a tie costs the plant a
little.

Each creature also has one signature skill. Turns won with a plain move charge it. A charged
skill lands whatever the boss does, then empties.

The plants fight as a team of two. On your move you may swap to the other plant instead of
using a move: that is your whole turn, and the boss's move lands on the plant coming in. Each
plant keeps its own health and skill charge while it waits. When the one in the fight faints,
the other steps in by itself. The fight is lost only when nobody is left."""
import json
import os
import random
from dataclasses import dataclass, replace
from typing import Optional

import config as C

MOVES = ("attack", "guard", "special")
SKILL = "skill"
SWAP = "swap"   # change to the plant on the bench: it takes the whole turn
PLAYER_MOVES = MOVES + (SKILL, SWAP)
BEATS = {"attack": "special", "special": "guard", "guard": "attack"}
BEATEN_BY = {loser: winner for winner, loser in BEATS.items()}  # the move that beats this one


@dataclass(frozen=True)
class Stats:
    name: str = "Sprout"
    hp: int = C.DEFAULT_CREATURE_HP
    atk: int = C.DEFAULT_CREATURE_ATK
    skill: str = C.DEFAULT_CREATURE_SKILL  # a key of config.SKILLS, or "" for none


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
    tier: int = 1            # which boss this is: decides how honest its tells are
    enraged: bool = False    # true once the boss is at half health or less
    intent: Optional[dict] = None  # the tell for the coming turn: what the boss shows
    boss_next: str = ""      # what the boss will really do. Never sent to the screen.
    seen: tuple = ()         # the player's last plain moves, newest last
    rested: tuple = ()       # (plant, hp, charge) of bench plants that have already been in this fight
    charge0: int = C.SKILL_CHARGE_START   # the charge a plant has the first time it is swapped in by choice


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
          rng: Optional[random.Random] = None) -> Battle:
    """A new fight. With an rng the boss's first tell is rolled straight away."""
    tier = clamp_tier(tier)
    boss = boss or boss_for_tier(tier)
    b = Battle(creature, boss, creature.hp, boss.hp, plant=plant, bench=tuple(bench),
               tier=tier, charge=charge, charge0=charge)
    return plan(b, rng) if rng is not None else b


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


def plant_hit(b: Battle, factor: float = 1.0) -> int:
    """What the plant's hit takes off the boss: its attack, times the player's standing buff."""
    return int(b.creature.atk * factor * C.PLAYER_DAMAGE_BUFF + 0.5)


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


def can_swap(b: Battle) -> bool:
    return bool(b.bench)


def bench_hp(b: Battle, plant: str) -> Optional[int]:
    """The health a waiting plant has kept, or None if it has not been in this fight yet."""
    return next((hp for p, hp, _ in b.rested if p == plant), None)


def _bring_in(b: Battle, fresh_charge: int) -> Battle:
    """The first plant on the bench takes the field, with the health and charge it left with.
    The one that was fighting is not placed anywhere: the caller benches it or counts it out."""
    (plant, stats), rest = b.bench[0], b.bench[1:]
    kept = next(((hp, charge) for p, hp, charge in b.rested if p == plant), None)
    hp, charge = kept if kept else (stats.hp, fresh_charge)
    return replace(b, creature=stats, creature_hp=hp, plant=plant, bench=rest, charge=charge, seen=(),
                   rested=tuple(r for r in b.rested if r[0] != plant))


def _swap_turn(b: Battle, boss_move: str) -> Battle:
    """The player's turn is spent changing plants. The boss's move lands on the one coming in."""
    out = (b.plant, b.creature, b.creature_hp, b.charge)
    took = boss_hit(b, boss_move)   # worked out before the change: the tell belongs to this turn
    shown = b.intent["move"] if b.intent else boss_move
    b = _bring_in(b, b.charge0)
    b = replace(b, bench=b.bench + ((out[0], out[1]),), rested=b.rested + ((out[0], out[2], out[3]),))
    log = {"creature": SWAP, "boss": boss_move, "shown": shown, "bluffed": boss_move != shown,
           "heavy": bool(b.intent and b.intent["heavy"]), "hit": "boss", "took": took,
           "swap": {"out": out[0], "in": b.plant, "name": b.creature.name, "chosen": True}}
    b = replace(b, creature_hp=max(0, b.creature_hp - took), turn=b.turn + 1, last_move=log,
                intent=None, boss_next="")
    return _send_in_next(b)


def resolve_turn(b: Battle, creature_move: str, boss_move: str) -> Battle:
    if creature_move == SWAP:
        if can_swap(b):
            return _swap_turn(b, boss_move)
        creature_move = "attack"  # nobody to swap to: it becomes a plain attack
    skill = skill_of(b.creature)
    use_skill = creature_move == SKILL and skill_ready(b)
    if creature_move == SKILL and not use_skill:
        creature_move = "attack"  # skill not charged (or none): it becomes a plain attack

    c_hp, b_hp, who, charge, seen = b.creature_hp, b.boss_hp, "tie", b.charge, b.seen
    shown = b.intent["move"] if b.intent else boss_move
    log = {"creature": creature_move, "boss": boss_move, "shown": shown,
           "bluffed": boss_move != shown, "heavy": bool(b.intent and b.intent["heavy"])}
    took = 0  # what the plant loses this turn

    if use_skill:
        damage = plant_hit(b, skill.get("damage_factor", 0))
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
            b_hp, who = b_hp - plant_hit(b), "creature"
            charge = min(C.SKILL_CHARGE_NEED, charge + 1)
            log["damage"] = plant_hit(b)
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
    down = (b.plant, b.creature)
    # A plant that has not fought yet arrives with its skill charged: that is the comeback.
    b = _bring_in(b, C.SKILL_CHARGE_NEED)
    step = {"out": down[0], "in": b.plant, "name": b.creature.name}
    # "back": the plant that was swapped in this turn went down at once, so the other returns
    log = dict(b.last_move, **({"back": step} if b.last_move.get("swap") else {"swap": step}))
    return replace(b, fallen=b.fallen + (down,), last_move=log)


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
