"""Tests for plant moves, XP and levels in battle. Run: python -m unittest test_progress -v  (from the server folder)"""
import os
import random
import tempfile
import unittest
from dataclasses import replace
from unittest import mock

import battle as B
import config as C
import plant_db as P
import state_machine as S
from engine import GameEngine

EMBER = "0450AA01F25713"
ZEST = "0450A901055713"
INTRO_DONE = C.BOSS_INTRO_SECONDS + 0.1


class MoveTests(unittest.TestCase):
    def plant(self, power=100):
        return B.Stats(name="P", hp=30, atk=8, skill="thorn_burst", plant_id="p",
                       moves=(("attack", "p-jab", power), ("guard", "p-wall", 100),
                              ("special", "p-flare", power), ("skill", "inferno-bloom", 100)))

    def test_power_100_hits_exactly_like_before(self):
        old = B.resolve_turn(B.start(B.Stats(atk=8)), "attack", "special")
        new = B.resolve_turn(B.start(self.plant()), "attack", "special")
        self.assertEqual(old.boss_hp, new.boss_hp)

    def test_more_power_hits_harder(self):
        start = B.start(self.plant(power=150))
        b = B.resolve_turn(start, "attack", "special")
        self.assertEqual(start.boss_hp - b.boss_hp, 12)  # 8 attack x 150%

    def test_the_log_names_the_move(self):
        b = B.resolve_turn(B.start(self.plant()), "special", "guard")
        self.assertEqual(b.last_move["move_id"], "p-flare")
        b = B.resolve_turn(B.start(self.plant(), charge=C.SKILL_CHARGE_NEED), "skill", "guard")
        self.assertEqual(b.last_move["move_id"], "inferno-bloom")

    def test_a_skill_that_is_not_ready_logs_the_attack_move(self):
        b = B.start(self.plant(), charge=0)  # not charged yet
        b = B.resolve_turn(b, "skill", "special")
        self.assertEqual(b.last_move["creature"], "attack")
        self.assertEqual(b.last_move["move_id"], "p-jab")

    def test_old_fighters_have_no_move_id(self):
        b = B.resolve_turn(B.start(B.Stats()), "attack", "special")
        self.assertNotIn("move_id", b.last_move)

    def test_move_ids_map_to_categories(self):
        self.assertEqual(B.category_of(self.plant(), "p-jab"), "attack")
        self.assertEqual(B.category_of(self.plant(), "guard"), "guard")
        self.assertIsNone(B.category_of(self.plant(), "zest-blade-rush"))  # not this plant's move


WEAK_BOSS = {1: ("Weak", 1, 0), 2: ("Weak", 1, 0), 3: ("Weak", 1, 0)}       # the plants always win
STRONG_BOSS = {1: ("Wall", 999, 99), 2: ("Wall", 999, 99), 3: ("Wall", 999, 99)}  # the plants always lose


class Fixture(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.db_path = os.path.join(self.dir.name, "progress.db")

    def engine(self, seed=1, manual=True):
        db = P.PlantDB.load(progress_path=self.db_path, background=False)
        e = GameEngine(rng=random.Random(seed), plant_db=db)
        e.manual = manual
        return e

    def fight(self, e, boss, demo=False, t=0.0, after_start=None):
        """Starts a fight for pot A against a fixed boss and plays it to the end. Fails if it never ends."""
        with mock.patch.object(C, "BOSS_TIERS", boss):
            if demo:
                e.on_demo_boss(t, "A")
            else:
                for _ in range(C.SOIL_DRY_READINGS_N):
                    e.on_soil_raw("A", C.SOIL_RAW_DRY, t)
            e.manual = False
            started = False
            for step in range(4000):
                t += 0.5
                if step % 4 == 0:  # keep the cube fresh: a long fight must not go stale
                    e.on_soil_raw("B", C.SOIL_RAW_WET, t)
                e.tick(t)
                if e.battle is not None and not started:
                    started = True
                    if after_start:
                        after_start(e, t)
                if started and e.game.mode not in (S.BOSS, S.BATTLE):
                    return t
        self.fail("the fight never ended")


class PlayerMoveTests(Fixture):
    def into_battle(self):
        e = self.engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_demo_boss(0.0, "A")
        e.tick(INTRO_DONE)
        return e, INTRO_DONE + 1.0

    def test_the_player_can_send_the_plants_own_move(self):
        e, t = self.into_battle()
        e.on_player_move("ember-flamingo-flare", t)
        self.assertEqual(e.battle.turn, 1)
        self.assertEqual(e.battle.last_move["creature"], "special")
        self.assertEqual(e.battle.last_move["move_id"], "ember-flamingo-flare")

    def test_another_plants_move_is_refused(self):
        e, t = self.into_battle()
        self.assertEqual(e.on_player_move("zest-blade-rush", t), [])
        self.assertEqual(e.battle.turn, 0)

    def test_the_old_category_names_still_work(self):
        e, t = self.into_battle()
        e.on_player_move("guard", t)
        self.assertEqual(e.battle.last_move["move_id"], "ember-petal-aegis")


class XpTests(Fixture):
    def two_plants(self):
        e = self.engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", ZEST, 0.0)
        return e

    def test_a_win_gives_xp_to_the_plants_in_the_fight(self):
        e = self.two_plants()
        self.fight(e, WEAK_BOSS)
        self.assertEqual(e.game.mode, S.REWARD)  # it really was a win
        xp = C.XP_PER_WIN_BY_TIER[3]  # bone-dry soil means a tier 3 boss
        self.assertEqual(e.plant_db.xp, {"ember": xp, "zest": xp})

    def test_demo_fights_give_no_xp(self):
        e = self.two_plants()
        self.fight(e, WEAK_BOSS, demo=True)
        self.assertEqual(e.game.mode, S.REWARD)  # the demo was won
        self.assertEqual(e.plant_db.xp, {"ember": 0, "zest": 0})

    def test_a_lost_fight_gives_no_xp(self):
        e = self.two_plants()
        self.fight(e, STRONG_BOSS)
        self.assertEqual(e.game.mode, S.COOLDOWN)  # it really was a loss
        self.assertIsNone(e.last_reward)
        self.assertEqual(e.plant_db.xp, {"ember": 0, "zest": 0})

    def test_a_plant_lifted_during_the_fight_gets_no_xp_even_if_put_back(self):
        # Rule: XP goes to the plants still in the fight's roster (fighting, bench or fainted) that
        # are on a pad when it ends. Lifting a plant takes it out of the roster.
        e = self.two_plants()
        def lift_and_return(e, t):
            e.on_pad("B", "", t)
            e.on_pad("B", ZEST, t)
        self.fight(e, WEAK_BOSS, after_start=lift_and_return)
        self.assertEqual(e.game.mode, S.REWARD)
        self.assertEqual(e.plant_db.xp["ember"], C.XP_PER_WIN_BY_TIER[3])
        self.assertEqual(e.plant_db.xp["zest"], 0)

    def test_a_fainted_plant_still_on_its_pad_gets_xp(self):
        e = self.two_plants()
        def ember_faints(e, t):
            e.battle = B._send_in_next(replace(e.battle, creature_hp=0, last_move={}))
        self.fight(e, WEAK_BOSS, after_start=ember_faints)
        self.assertEqual(e.game.mode, S.REWARD)
        self.assertEqual(e.plant_db.xp["ember"], C.XP_PER_WIN_BY_TIER[3])
        self.assertEqual(e.plant_db.xp["zest"], C.XP_PER_WIN_BY_TIER[3])

    def test_xp_survives_a_restart_and_makes_the_plant_stronger(self):
        e = self.two_plants()
        self.fight(e, WEAK_BOSS)
        again = self.engine()
        self.assertEqual(again.plant_db.xp["ember"], C.XP_PER_WIN_BY_TIER[3])
        again.plant_db.xp["ember"] = P.xp_to_reach(5)
        again.on_pad("A", EMBER, 0.0)
        hp, atk = P.stats_at_level(again.plant_db.plants["ember"], 5)
        self.assertEqual((again.fighter("A").hp, again.fighter("A").atk), (hp, atk))
        self.assertGreater(hp, 30)

    def test_levels_do_not_change_a_fight_in_progress(self):
        e = self.two_plants()
        def level_up_now(e, t):
            e.plant_db.xp["ember"] = P.xp_to_reach(5)
        self.fight(e, WEAK_BOSS, after_start=level_up_now)
        self.assertGreater(e.battle.turn, 0)  # turns were played after the level-up
        self.assertEqual((e.battle.creature.hp, e.battle.creature.atk), (30, 8))  # still level 1 numbers
        self.assertGreater(e.fighter("A").hp, 30)  # the next fight uses the new level

    def test_xp_is_paid_once_even_if_the_finish_runs_twice(self):
        e = self.two_plants()
        self.fight(e, WEAK_BOSS)
        total = e.plant_db.xp["ember"]
        e._award_xp(3)  # the same fight again
        self.assertEqual(e.plant_db.xp["ember"], total)

    def test_without_the_database_nothing_changes(self):
        e = GameEngine(rng=random.Random(1), need_pads=False)
        self.fight(e, WEAK_BOSS)
        self.assertIsNone(e.last_xp)


if __name__ == "__main__":
    unittest.main()
