"""Victory badges. Run: python -m unittest test_badges -v  (from the server folder)"""
import os
import random
import tempfile
import unittest
from dataclasses import replace

import battle as B
import config as C
import state_machine as S
from badges import DESIGNS, BadgeBook
from engine import GameEngine

INTRO_DONE = C.BOSS_INTRO_SECONDS + 0.1


def win(e, t=0.0, demo=True):
    """A fight for pot A, won on the player's move."""
    e.manual = True
    e.on_soil_raw("A", C.SOIL_RAW_DRY, t)
    if demo:
        e.on_demo_boss(t, "A")
    t += INTRO_DONE
    e.tick(t)
    for _ in range(5):   # a charged skill always lands
        if e.game.mode != S.BATTLE:
            break
        t += C.BATTLE_TURN_SECONDS + 0.1
        e.battle = replace(e.battle, boss_hp=1, charge=C.SKILL_CHARGE_NEED)
        e.on_player_move("skill", t)
    return e


class BookTests(unittest.TestCase):
    def test_designs_cycle_and_the_rank_goes_up(self):
        book = BadgeBook()
        badges = [book.award(f"fight{i}", "chomper", "A", now=1.0) for i in range(len(DESIGNS) + 1)]
        self.assertEqual(badges[0]["name"], "Dew Guardian · Rank 1")
        self.assertEqual(badges[-1]["name"], "Dew Guardian · Rank 2")
        self.assertEqual([b["number"] for b in badges], list(range(1, len(DESIGNS) + 2)))

    def test_one_fight_earns_one_badge(self):
        book = BadgeBook()
        self.assertEqual(book.award("x", "chomper", "A"), book.award("x", "chomper", "A"))
        self.assertEqual(len(book.collection()), 1)
        self.assertIsNone(book.award("", "chomper", "A"))

    def test_the_collection_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "badges.json")
            BadgeBook(path).award("x", "sporelings", "ember")
            again = BadgeBook(path).collection()
            self.assertEqual([(b["number"], b["boss"], b["plantId"]) for b in again], [(1, "sporelings", "ember")])

    def test_a_broken_file_starts_empty_instead_of_crashing(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "badges.json")
            with open(path, "w") as f:
                f.write("not json")
            self.assertEqual(BadgeBook(path).collection(), [])


class EngineTests(unittest.TestCase):
    def engine(self):
        return GameEngine(rng=random.Random(1), need_pads=False, auto_play=False, badges=BadgeBook())

    def test_a_won_fight_earns_a_badge_and_shows_it(self):
        e = win(self.engine())
        self.assertEqual(e.game.mode, S.REWARD)
        snap = e.snapshot()
        self.assertEqual(len(snap["badges"]), 1)
        self.assertEqual(snap["last_badge"]["number"], 1)
        self.assertIn(snap["last_badge"]["boss"], C.BOSS_KINDS)

    def test_a_lost_fight_earns_nothing(self):
        e = self.engine()
        e.manual = True
        e.on_soil_raw("A", C.SOIL_RAW_DRY, 0.0)
        e.on_demo_boss(0.0, "A")
        e.tick(INTRO_DONE)
        e.battle = replace(e.battle, creature_hp=1, boss_hp=999, bench=())
        for i in range(10):
            if e.game.mode != S.BATTLE:
                break
            e.battle = replace(e.battle, creature_hp=1, boss_hp=999)
            e.on_player_move("special", INTRO_DONE + 1.0 + i * 7)   # loses to a boss attack or ties
        self.assertEqual(e.snapshot()["badges"], [])

    def test_each_win_adds_the_next_badge(self):
        e = win(self.engine())
        win(e, t=1000.0)
        self.assertEqual([b["number"] for b in e.snapshot()["badges"]], [1, 2])

    def test_no_badge_book_means_no_badges(self):
        e = win(GameEngine(rng=random.Random(1), need_pads=False, auto_play=False))
        self.assertEqual(e.snapshot()["badges"], [])
        self.assertIsNone(e.snapshot()["last_badge"])


if __name__ == "__main__":
    unittest.main()
