"""Tests for NFC summoning with the plant database. Run: python -m unittest test_summon -v  (from the server folder)"""
import random
import unittest

import config as C
import plant_db as P
import state_machine as S
from engine import GameEngine

EMBER = "0450AA01F25713"
ZEST = "0450A901055713"
INTRO_DONE = C.BOSS_INTRO_SECONDS + 0.1


def engine(seed=1, manual=True):
    db = P.PlantDB.load(progress_path=None)
    e = GameEngine(rng=random.Random(seed), plant_db=db)
    e.manual = manual
    return e


def to_battle(e, pad="A", now=0.0):
    e.on_demo_boss(now, pad)
    e.tick(now + INTRO_DONE)
    return now + INTRO_DONE


class SummonTests(unittest.TestCase):
    def test_a_known_tag_summons_its_plant(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        self.assertEqual(e.summoned(), [("A", "ember")])
        self.assertEqual(e.pad_status["A"], "known")

    def test_the_plant_follows_its_tag_to_either_pad(self):
        e = engine()
        e.on_pad("B", EMBER, 0.0)
        self.assertEqual(e.summoned(), [("B", "ember")])

    def test_lifting_the_tag_unsummons(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("A", "", 1.0)
        self.assertEqual(e.summoned(), [])
        self.assertEqual(e.pad_status["A"], "empty")

    def test_the_same_message_twice_changes_nothing(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("A", EMBER, 1.0)
        self.assertEqual(e.summoned(), [("A", "ember")])

    def test_unknown_and_garbage_tags_summon_nobody(self):
        e = engine()
        e.on_pad("A", "DEADBEEF", 0.0)
        e.on_pad("B", "not a tag", 0.0)
        self.assertEqual(e.summoned(), [])
        self.assertEqual(e.pad_status, {"A": "unknown", "B": "invalid"})

    def test_a_tag_moved_to_the_other_pad_is_only_summoned_once(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", EMBER, 1.0)  # old retained message on A is out of date
        self.assertEqual(e.summoned(), [("B", "ember")])
        self.assertEqual(e.pad_status["A"], "moved")

    def test_two_plants(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", ZEST, 0.0)
        self.assertEqual(e.summoned(), [("A", "ember"), ("B", "zest")])

    def test_colon_form_of_a_real_tag_still_matches(self):
        e = engine()
        e.on_pad("A", "04:50:AA:01:F2:57:13", 0.0)
        self.assertEqual(e.summoned(), [("A", "ember")])


class BattleWithSummonedPlantsTests(unittest.TestCase):
    def test_no_plants_means_the_boss_waits(self):
        e = engine()
        to_battle(e)
        self.assertEqual(e.game.mode, S.BOSS)
        self.assertIsNone(e.battle)

    def test_placing_a_plant_lets_the_waiting_boss_fight(self):
        e = engine()
        t = to_battle(e)
        e.on_pad("A", EMBER, t)
        e.tick(t + 0.2)
        self.assertEqual(e.game.mode, S.BATTLE)
        self.assertEqual(e.battle.creature.plant_id, "ember")

    def test_only_summoned_plants_fight(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        to_battle(e)
        self.assertEqual(e.battle.creature.name, "Ember")
        self.assertEqual(e.battle.bench, ())

    def test_both_summoned_plants_form_the_team(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", ZEST, 0.0)
        to_battle(e, "A")
        self.assertEqual(e.battle.plant, "A")
        self.assertEqual([s.plant_id for _, s in e.battle.bench], ["zest"])

    def test_a_plant_on_the_other_pad_fights_for_the_dry_pot(self):
        e = engine()
        e.on_pad("B", ZEST, 0.0)
        to_battle(e, "A")  # pot A is dry, but only Zest (on pad B) is here
        self.assertEqual(e.battle.creature.plant_id, "zest")
        self.assertEqual(e.game.boss_plant, "A")  # watering still goes to pot A

    def test_lifting_the_bench_plant_removes_it(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", ZEST, 0.0)
        t = to_battle(e, "A")
        e.on_pad("B", "", t)
        self.assertEqual(e.battle.bench, ())
        self.assertEqual(e.battle.creature.plant_id, "ember")

    def test_lifting_the_fighter_brings_in_the_next_plant(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", ZEST, 0.0)
        t = to_battle(e, "A")
        e.on_pad("A", "", t)
        self.assertEqual(e.battle.creature.plant_id, "zest")
        self.assertEqual(e.battle.last_move["swap"]["reason"], "lifted")

    def test_lifting_the_last_fighter_pauses_the_fight_with_no_water(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        t = to_battle(e, "A")
        cmds = []
        e.on_pad("A", "", t)
        self.assertIsNone(e.battle)
        self.assertEqual(e.game.mode, S.BOSS)
        for i in range(200):
            cmds += e.tick(t + i * 0.5)
        self.assertEqual(cmds, [])
        self.assertEqual(e.game.mode, S.BOSS)  # still waiting for a plant

    def test_a_plant_placed_mid_battle_does_not_join_it(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        t = to_battle(e, "A")
        e.on_pad("B", ZEST, t)
        self.assertEqual(e.battle.bench, ())
        self.assertEqual(e.summoned(), [("A", "ember"), ("B", "zest")])  # but it is in the party now

    def test_snapshot_still_has_the_old_fields(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        snap = e.snapshot()
        for key in ("creatures", "meters", "mode", "boss", "battle", "reward", "fighters"):
            self.assertIn(key, snap)
        self.assertEqual(snap["fighters"]["A"]["name"], "Ember")
        self.assertIsNone(snap["fighters"]["B"])


def pump_trace(e, minutes=40, detail=False):
    """Runs a long story (pot A dries, gets watered, dries again; pot B dries later) and returns
    every command as (time, topic, payload). With detail, each entry also has what the engine knew
    when it sent it: the reward record, the pot's soil percent and whether the cube was offline."""
    trace, t = [], 0.0
    def record(cmds):
        for c in cmds:
            entry = (round(t, 1), c.topic, c.payload)
            if detail:
                pot = (e.last_reward or {}).get("plant")
                entry += (dict(e.last_reward or {}), e.soil_pct.get(pot), e.game.stale)
            trace.append(entry)
    for step in range(int(minutes * 60 / 0.5)):
        t = step * 0.5
        if step % 4 == 0:  # a soil reading every 2 s, like the firmware
            record(e.on_soil_raw("A", C.SOIL_RAW_DRY if (t // 300) % 2 == 0 else C.SOIL_RAW_WET, t))
            record(e.on_soil_raw("B", C.SOIL_RAW_DRY if t > 900 else C.SOIL_RAW_WET, t))
        record(e.tick(t))
    return trace


class PumpRegressionTests(unittest.TestCase):
    """The plant database must not change when, where or how long a pump runs."""

    def test_identical_pump_commands_with_and_without_the_database(self):
        # With level growth switched off, plants never get stronger, so the fights play out exactly
        # as before. Any difference would mean the database changed the watering path itself.
        from unittest import mock
        with mock.patch.object(C, "HP_PER_LEVEL", 0), mock.patch.object(C, "ATK_LEVELS_PER_POINT", 10 ** 6):
            old = GameEngine(rng=random.Random(7))
            new = engine(seed=7, manual=False)
            new.on_pad("A", EMBER, 0.0)   # Ember and Zest have the same numbers as the old pad defaults
            new.on_pad("B", ZEST, 0.0)
            old_trace, new_trace = pump_trace(old), pump_trace(new)
        self.assertGreater(len(old_trace), 1)  # the story really waters more than once
        self.assertEqual(new_trace, old_trace)

    def test_with_levels_every_pump_command_still_follows_the_rules(self):
        # Stronger plants win sooner, so the timing may move, but each command must match the fight
        # that earned it: that fight's pot, the exact length for its boss tier, dry soil, cube online,
        # and the reward gap for that pot.
        new = engine(seed=7, manual=False)
        new.on_pad("A", EMBER, 0.0)
        new.on_pad("B", ZEST, 0.0)
        trace = pump_trace(new, detail=True)
        self.assertGreater(len(trace), 1)
        last = {}
        for t, topic, payload, reward, soil_pct, stale in trace:
            self.assertEqual(topic, C.TOPIC_CMD_PUMP.format(plant=reward["plant"]))
            expected = min(C.PUMP_MS_BY_TIER.get(reward["tier"], C.PUMP_MS_PER_WIN), C.PUMP_MAX_MS)
            self.assertEqual(int(payload), expected)
            self.assertGreater(int(payload), 0)
            self.assertLess(soil_pct, C.SOIL_WET_THRESHOLD_PCT)  # never waters a wet pot (no demo here)
            self.assertFalse(stale)
            if topic in last:
                self.assertGreaterEqual(t - last[topic], C.REWARD_MIN_GAP_SECONDS)
            last[topic] = t

    def test_a_cancelled_battle_never_reaches_the_reward(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        t = to_battle(e, "A")
        calls = []
        real = e._finish_battle
        e._finish_battle = lambda won, now: calls.append(won) or real(won, now)
        e.on_pad("A", "", t)
        for i in range(100):
            e.tick(t + i * 0.5)
        self.assertEqual(calls, [])

    def test_a_broken_plant_file_falls_back_to_the_old_engine(self):
        from unittest import mock
        import main
        import plant_db
        with mock.patch.object(C, "USE_PLANT_DB", True), \
                mock.patch.object(plant_db.PlantDB, "load", side_effect=ValueError("bad plants.json")):
            e = main.make_engine()
        self.assertIsNone(e.plant_db)
        to_battle(e)
        self.assertIsNotNone(e.battle)  # still plays (and waters) the old way


class WaitingBossTests(unittest.TestCase):
    def soil_boss(self):
        e = engine()
        for _ in range(C.SOIL_DRY_READINGS_N):
            e.on_soil_raw("A", C.SOIL_RAW_DRY, 0.0)
        e.tick(INTRO_DONE)
        self.assertEqual(e.game.mode, S.BOSS)
        return e

    def test_wet_soil_dismisses_a_waiting_boss(self):
        e = self.soil_boss()
        e.on_soil_raw("A", C.SOIL_RAW_WET, INTRO_DONE + 1)
        self.assertEqual(e.game.mode, S.WALKING)

    def test_going_offline_dismisses_a_waiting_boss(self):
        e = self.soil_boss()
        e.on_esp_status("offline", INTRO_DONE + 1)
        self.assertEqual(e.game.mode, S.WALKING)

    def test_the_demo_button_is_ignored_while_a_boss_waits(self):
        e = self.soil_boss()
        e.on_demo_boss(INTRO_DONE + 1, "B")
        self.assertEqual(e.game.boss_plant, "A")

    def test_lift_and_replace_during_the_intro(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_demo_boss(0.0, "A")
        e.on_pad("A", "", 1.0)
        e.on_pad("A", ZEST, 2.0)
        e.tick(INTRO_DONE)
        self.assertEqual(e.battle.creature.plant_id, "zest")


class MoreLiftTests(unittest.TestCase):
    def test_lifts_during_reward_and_cooldown_change_nothing(self):
        from unittest import mock
        weak = {1: ("Weak", 1, 0), 2: ("Weak", 1, 0), 3: ("Weak", 1, 0)}  # the plants always win
        for stage in (S.REWARD, S.COOLDOWN):
            with mock.patch.object(C, "BOSS_TIERS", weak):
                e = engine(manual=False)
                e.on_pad("A", EMBER, 0.0)
                e.on_pad("B", ZEST, 0.0)
                t = to_battle(e, "A")
                for _ in range(4000):
                    if e.game.mode == stage:
                        break
                    t += 0.5
                    e.tick(t)
                self.assertEqual(e.game.mode, stage)
                reward = e.last_reward
                e.on_pad("A", "", t)
                e.on_pad("B", "", t)
                self.assertEqual(e.game.mode, stage, stage)
                self.assertEqual(e.last_reward, reward, stage)

    def test_swapping_tags_between_pads_in_either_order(self):
        for first, second in (("A", "B"), ("B", "A")):
            e = engine()
            e.on_pad("A", EMBER, 0.0)
            e.on_pad("B", ZEST, 0.0)
            t = to_battle(e, "A")
            tags = {"A": ZEST, "B": EMBER}
            e.on_pad(first, tags[first], t)
            e.on_pad(second, tags[second], t)
            self.assertEqual(sorted(e.summoned()), [("A", "zest"), ("B", "ember")])
            e.tick(t + 0.2)
            self.assertIsNotNone(e.battle)  # a fresh fight with the new arrangement
            self.assertEqual(e.game.boss_plant, "A")

    def test_retained_messages_before_the_first_tick(self):
        e = engine()
        e.on_pad("A", EMBER)  # no time given, as at start-up
        e.on_pad("B", ZEST)
        self.assertEqual(len(e.summoned()), 2)

    def test_lifting_a_plant_that_already_fainted_changes_nothing(self):
        import battle as Bt
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", ZEST, 0.0)
        t = to_battle(e, "A")
        e.battle = Bt._send_in_next(Bt.replace(e.battle, creature_hp=0, last_move={}))  # Ember faints, Zest in
        fallen = e.battle.fallen
        e.on_pad("A", "", t)
        self.assertEqual(e.battle.fallen, fallen)
        self.assertEqual(e.battle.creature.plant_id, "zest")

    def test_the_incoming_plant_starts_with_its_skill_ready(self):
        import battle as Bt
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", ZEST, 0.0)
        t = to_battle(e, "A")
        e.battle = Bt.replace(e.battle, skill_ready_in=3)
        e.on_pad("A", "", t)
        self.assertEqual(e.battle.skill_ready_in, 0)


class LegacyStillWorksTests(unittest.TestCase):
    def test_without_the_database_an_empty_pad_still_fights(self):
        e = GameEngine(rng=random.Random(1))
        e.manual = True
        to_battle(e)
        self.assertIsNotNone(e.battle)


if __name__ == "__main__":
    unittest.main()
