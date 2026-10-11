"""Balance bands. Seeded, so the numbers are exact and repeatable. Both lead orders (A first, B
first) are played equally. Runs as part of `python3 test_server.py`.

Player models:
  masher     a random move every turn, the skill whenever it is ready
  autopilot  what the game plays for an absent player (battle.auto_move)
  reader     counters every shown intent; cashes the skill on a "?" with a bloom banked, or to finish
  spam1      always Attack (reported; soft target)

The tier numbers in config.BOSS_TIERS were tuned on 20k fights per tier (see the table there);
these tests use fewer fights to stay fast.

Welfare rule: nobody does worse than in the old game (before intents and blooms) by more than one
point. Old rates: always-Attack 95.4 / 92.9 / 86.9 %, masher 99.4 / 99.2 / 96.3 %. The floors below
are those minus 1, so any change that makes a plant thirstier for a casual player fails here."""
import random
import unittest

import battle as B
import config as C

FIGHTS = 3000    # per tier and player model

OLD_SPAM1 = {1: 0.954, 2: 0.929, 3: 0.869}
OLD_MASHER = {1: 0.994, 2: 0.992, 3: 0.963}
FLOOR = 0.01     # at most one point worse than the old game


def masher(b, rng):
    if B.skill_of(b.creature) is not None and b.skill_ready_in == 0:
        return B.SKILL
    return rng.choice(B.MOVES)


def reader(b, rng):
    skill = B.skill_of(b.creature)
    ready = skill is not None and b.skill_ready_in == 0
    if ready and B.skill_finishes(b):
        return B.SKILL
    if b.intent is not None:
        return B.COUNTER[b.intent]
    if ready and b.blooms >= 1 and (B.skill_kind(skill) != "heal" or B.heal_worth_it(b)):
        return B.SKILL
    return rng.choice(B.MOVES)


def autopilot(b, rng):
    return B.auto_move(b, rng)


def spam1(b, rng):
    return "attack"


def fight(tier, first, policy, rng):
    other = "B" if first == "A" else "A"
    b = B.start(B.plant_fighter(first), B.boss_for_tier(tier), plant=first,
                bench=[(other, B.plant_fighter(other))], show_rate=B.show_rate_for_tier(tier))
    b = B.roll_intent(b, rng)
    while B.winner(b) is None:
        b = B.play_turn(b, rng, policy(b, rng))
    return B.winner(b) == "creature", b.turn


_cache = {}


def rates(tier, policy):
    """(win rate, mean turns) over FIGHTS seeded fights."""
    key = (tier, policy.__name__)
    if key not in _cache:
        wins = turns = 0
        for i in range(FIGHTS):
            won, n = fight(tier, "AB"[i % 2], policy, random.Random(1_000_003 * tier + i))
            wins += won
            turns += n
        _cache[key] = (wins / FIGHTS, turns / FIGHTS)
    return _cache[key]


class BalanceBandTests(unittest.TestCase):
    def test_a_masher_does_no_worse_than_in_the_old_game(self):
        for tier, old in OLD_MASHER.items():
            self.assertGreaterEqual(rates(tier, masher)[0], old - FLOOR, f"tier {tier}")

    def test_always_attack_does_no_worse_than_in_the_old_game(self):
        for tier, old in OLD_SPAM1.items():
            self.assertGreaterEqual(rates(tier, spam1)[0], old - FLOOR, f"tier {tier}")

    def test_autopilot_wins_almost_always(self):
        for tier in (1, 2, 3):
            self.assertGreaterEqual(rates(tier, autopilot)[0], 0.98, f"tier {tier}")

    def test_a_reader_wins_and_wins_fast(self):
        for tier in (1, 2, 3):
            win, turns = rates(tier, reader)
            self.assertGreaterEqual(win, 0.999, f"tier {tier}")
            self.assertGreaterEqual(turns, 4.5, f"tier {tier}")
            self.assertLessEqual(turns, 7.5, f"tier {tier}")

    def test_reading_the_boss_is_worth_it(self):
        for tier in (1, 2, 3):
            self.assertLessEqual(rates(tier, reader)[1], 0.6 * rates(tier, masher)[1], f"tier {tier}")

    def test_tiers_get_harder(self):
        hp = [B.boss_for_tier(t).hp for t in (1, 2, 3)]
        atk = [B.boss_for_tier(t).atk for t in (1, 2, 3)]
        self.assertEqual(hp, sorted(hp))
        self.assertEqual(atk, sorted(atk))
        spam_wins = [rates(t, spam1)[0] for t in (1, 2, 3)]
        self.assertEqual(spam_wins, sorted(spam_wins, reverse=True))
        self.assertEqual([C.INTENT_SHOW_RATE[t] for t in (1, 2, 3)],
                         sorted(C.INTENT_SHOW_RATE.values(), reverse=True))


def report():
    print("tier  masher        autopilot     reader        spam1")
    for tier in (1, 2, 3):
        cells = ["%5.1f%% %4.1ft" % (rates(tier, p)[0] * 100, rates(tier, p)[1])
                 for p in (masher, autopilot, reader, spam1)]
        print(f"{tier}     " + "  ".join(cells))


if __name__ == "__main__":
    report()
