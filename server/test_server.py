"""Run: python -m unittest test_server -v  (from the server folder, no hardware needed)"""
import random
import unittest

import battle as B
import config as C
import rewards as R
import state_machine as S
from engine import GameEngine

DRY_RAW = C.SOIL_RAW_DRY
WET_RAW = C.SOIL_RAW_WET


def feed_dry(g, plant="A", n=C.SOIL_DRY_READINGS_N, now=0.0):
    for _ in range(n):
        g = S.on_soil(g, plant, 5.0, now)
    return g


class StateMachineTests(unittest.TestCase):
    def test_soil_pct_endpoints(self):
        self.assertEqual(S.soil_pct(DRY_RAW), 0.0)
        self.assertEqual(S.soil_pct(WET_RAW), 100.0)

    def test_noisy_reading_never_summons(self):
        g = feed_dry(S.Game(), n=C.SOIL_DRY_READINGS_N - 1)
        g = S.on_soil(g, "A", 80.0, 0)  # wet blip resets the streak
        g = S.on_soil(g, "A", 5.0, 0)
        self.assertEqual(g.mode, S.WALKING)

    def test_n_dry_readings_summon(self):
        g = feed_dry(S.Game())
        self.assertEqual((g.mode, g.boss_plant), (S.BOSS, "A"))

    def test_hysteresis_dead_band_keeps_boss(self):
        g = feed_dry(S.Game())
        mid = (C.SOIL_DRY_THRESHOLD_PCT + C.SOIL_WET_THRESHOLD_PCT) / 2
        g = S.on_soil(g, "A", mid, 1)
        self.assertEqual(g.mode, S.BOSS)
        g = S.on_soil(g, "A", C.SOIL_WET_THRESHOLD_PCT + 1, 2)
        self.assertEqual(g.mode, S.WALKING)

    def test_intro_then_battle(self):
        g = S.on_tick(feed_dry(S.Game()), C.BOSS_INTRO_SECONDS)
        self.assertEqual(g.mode, S.BATTLE)

    def test_loss_gives_no_reward_and_cooldown_blocks_boss(self):
        g = S.on_tick(feed_dry(S.Game()), C.BOSS_INTRO_SECONDS)
        g, plant = S.on_battle_done(g, False, 10.0)
        self.assertIsNone(plant)
        self.assertEqual(g.mode, S.COOLDOWN)
        g = feed_dry(g, now=11.0)
        self.assertEqual(g.mode, S.COOLDOWN)
        g = S.on_tick(g, 10.0 + C.COOLDOWN_SECONDS)
        self.assertEqual(g.mode, S.WALKING)
        g = feed_dry(g, now=10.0 + C.COOLDOWN_SECONDS)
        self.assertEqual(g.mode, S.BOSS)

    def test_win_rewards_boss_plant(self):
        g = S.on_tick(feed_dry(S.Game(), "B"), C.BOSS_INTRO_SECONDS)
        g, plant = S.on_battle_done(g, True, 10.0)
        self.assertEqual((g.mode, plant), (S.REWARD, "B"))

    def test_demo_boss_ignores_soil_and_is_marked_demo(self):
        g = S.on_demo(S.Game(), "B", 0)
        self.assertEqual((g.mode, g.boss_plant, g.source), (S.BOSS, "B", C.SOURCE_DEMO))
        g = S.on_soil(g, "B", 99.0, 1)  # wet soil does not dismiss a demo boss
        self.assertEqual(g.mode, S.BOSS)

    def test_demo_ignored_while_boss_or_battle_active(self):
        g = S.on_demo(S.Game(), "A", 0)
        self.assertEqual(S.on_demo(g, "B", 1).boss_plant, "A")
        g = S.on_tick(g, C.BOSS_INTRO_SECONDS)
        self.assertEqual(S.on_demo(g, "B", 5).mode, S.BATTLE)

    def test_demo_loss_retreats_like_a_real_boss(self):
        g = S.on_tick(S.on_demo(S.Game(), "A", 0), C.BOSS_INTRO_SECONDS)
        g, plant = S.on_battle_done(g, False, 10.0)
        self.assertEqual((g.mode, plant, g.source), (S.COOLDOWN, None, None))

    def test_wet_soil_dismisses_real_boss_during_battle(self):
        g = S.on_tick(feed_dry(S.Game()), C.BOSS_INTRO_SECONDS)
        self.assertEqual(g.mode, S.BATTLE)
        g = S.on_soil(g, "A", C.SOIL_WET_THRESHOLD_PCT + 1, 5)
        self.assertEqual((g.mode, g.boss_plant), (S.WALKING, None))

    def test_offline_drops_boss_and_battle(self):
        g = S.on_tick(feed_dry(S.Game()), C.BOSS_INTRO_SECONDS)
        g = S.on_status(g, False)
        self.assertEqual((g.mode, g.stale), (S.WALKING, True))
        g = S.on_status(S.on_demo(S.Game(), "A", 0), False)
        self.assertEqual(g.mode, S.WALKING)

    def test_offline_marks_stale(self):
        self.assertTrue(S.on_status(S.Game(), False).stale)
        self.assertFalse(S.on_status(S.Game(stale=True), True).stale)


class RewardTests(unittest.TestCase):
    def test_dry_soil_gets_bounded_pump(self):
        cmd = R.water_reward("A", 10.0, 1000.0, float("-inf"))
        self.assertEqual(cmd.topic, "incube/cmd/pump/A")
        self.assertLessEqual(int(cmd.payload), C.PUMP_MAX_MS)

    def test_wet_soil_gets_nothing(self):
        self.assertIsNone(R.water_reward("A", C.SOIL_WET_THRESHOLD_PCT, 1000.0, float("-inf")))

    def test_demo_may_water_wet_soil_but_gap_and_cap_still_apply(self):
        cmd = R.water_reward("A", 99.0, 1000.0, float("-inf"), demo=True)
        self.assertLessEqual(int(cmd.payload), C.PUMP_MAX_MS)
        self.assertIsNone(R.water_reward("A", 99.0, 100.0, 100.0 - 1, demo=True))

    def test_one_reward_per_cooldown(self):
        self.assertIsNone(R.water_reward("A", 10.0, 100.0, 100.0 - 1))

    def test_cap_holds_even_if_config_is_too_big(self):
        old = C.PUMP_MS_PER_WIN
        C.PUMP_MS_PER_WIN = C.PUMP_MAX_MS * 10
        try:
            cmd = R.water_reward("A", 10.0, 1000.0, float("-inf"))
            self.assertEqual(int(cmd.payload), C.PUMP_MAX_MS)
        finally:
            C.PUMP_MS_PER_WIN = old


class BattleTests(unittest.TestCase):
    def test_rules(self):
        b = B.start(B.Stats(hp=10, atk=5), B.Stats(hp=10, atk=3))
        b = B.resolve_turn(b, "attack", "special")
        self.assertEqual(b.boss_hp, 5)
        b = B.resolve_turn(b, "attack", "attack")
        self.assertEqual((b.boss_hp, b.creature_hp), (5, 10))
        b = B.resolve_turn(b, "attack", "guard")
        self.assertEqual(b.creature_hp, 7)

    def test_fight_ends_with_a_winner(self):
        b = B.start(B.Stats())
        rng = random.Random(1)
        for _ in range(500):
            b = B.play_turn(b, rng)
            if B.winner(b):
                break
        self.assertIsNotNone(B.winner(b))


class EngineFlowTests(unittest.TestCase):
    def run_flow(self, force=False, wet_pot=False):
        e = GameEngine(rng=random.Random(3))
        t, cmds = 0.0, []
        if force:
            cmds += e.on_debug_boss("A", t)
        else:
            for _ in range(C.SOIL_DRY_READINGS_N):
                cmds += e.on_soil_raw("A", DRY_RAW, t)
        if wet_pot:
            e.soil_pct["A"] = 100.0
        for _ in range(3000):
            t += 0.5
            cmds += e.tick(t)
        return e, cmds

    def test_dry_soil_to_boss_to_battle_to_cooldown(self):
        e, cmds = self.run_flow()
        self.assertEqual(e.game.mode, S.WALKING)
        self.assertLessEqual(len(cmds), 1)
        for c in cmds:
            self.assertLessEqual(int(c.payload), C.PUMP_MAX_MS)

    def test_snapshot_has_agreed_fields(self):
        snap = GameEngine().snapshot()
        for key in ("creatures", "meters", "mode", "boss", "battle", "reward"):
            self.assertIn(key, snap)
        self.assertIn("stale", snap["meters"])

    def test_wet_soil_never_gets_water(self):
        e = GameEngine(rng=random.Random(3))
        for _ in range(C.SOIL_DRY_READINGS_N):
            e.on_soil_raw("A", DRY_RAW, 0.0)
        e.on_soil_raw("B", WET_RAW, 0.0)
        e.soil_pct["A"] = 100.0
        cmds, t = [], 0.0
        for _ in range(100):
            t += 0.5
            cmds += e.tick(t)
        self.assertEqual(cmds, [])

    def play_demo(self, e, t):
        cmds = e.on_demo_boss(t)
        for _ in range(400):
            t += 0.5
            cmds += e.tick(t)
        return cmds, t

    def test_demo_win_waters_wet_pot_once_and_repeat_is_blocked(self):
        old_gap = C.REWARD_MIN_GAP_SECONDS
        C.REWARD_MIN_GAP_SECONDS = 10 ** 6
        try:
            for seed in range(50):
                e = GameEngine(rng=random.Random(seed))
                cmds, t = self.play_demo(e, 0.0)  # soil is 100% wet by default
                if cmds:
                    break
            self.assertEqual(len(cmds), 1)
            self.assertLessEqual(int(cmds[0].payload), C.PUMP_MAX_MS)
            for _ in range(5):  # repeated presses cannot flood the pot
                again, t = self.play_demo(e, t)
                self.assertEqual(again, [])
        finally:
            C.REWARD_MIN_GAP_SECONDS = old_gap

    def test_demo_boss_source_in_snapshot(self):
        e = GameEngine()
        e.on_demo_boss(0.0)
        self.assertEqual(e.snapshot()["boss"]["source"], C.SOURCE_DEMO)

    def test_demo_ignored_while_active(self):
        e = GameEngine()
        e.on_demo_boss(0.0)
        e.on_pad("B", "uid")
        e.on_demo_boss(0.1)
        self.assertEqual(e.game.boss_plant, "A")

    def test_demo_targets_active_plant(self):
        e = GameEngine()
        e.on_pad("B", "uid")
        self.assertEqual(e.pick_demo_plant(), "B")
        e.on_pad("A", "uid2")
        e.soil_pct = {"A": 50.0, "B": 20.0}
        self.assertEqual(e.pick_demo_plant(), "B")
        e.on_pad("B", "")
        self.assertEqual(e.pick_demo_plant(), "A")

    def test_offline_mid_battle_sends_no_pump(self):
        e = GameEngine(rng=random.Random(1))
        cmds = e.on_demo_boss(0.0)
        t = 0.0
        for _ in range(8):
            t += 0.5
            cmds += e.tick(t)
        e.on_esp_status("offline")
        for _ in range(400):
            t += 0.5
            cmds += e.tick(t)
        self.assertEqual((cmds, e.game.mode), ([], S.WALKING))


if __name__ == "__main__":
    unittest.main()
