"""Live play: the game never fights by itself. Run: python -m unittest test_live_play -v  (from the server folder)"""
import random
import unittest
from unittest import mock

import config as C
import state_machine as S
from engine import GameEngine

WEAK_BOSS = {1: ("Weak", 1, 0), 2: ("Weak", 1, 0), 3: ("Weak", 1, 0)}   # any landed hit wins


def live():
    """An engine like main.py makes: no auto play."""
    return GameEngine(rng=random.Random(1), need_pads=False, auto_play=False)


def dry(e, plant, t, readings=C.SOIL_DRY_READINGS_N):
    for i in range(readings):
        cmds = e.on_soil_raw(plant, C.SOIL_RAW_DRY, t + i * 2)
    return t + readings * 2


def run(e, t, seconds, step=0.5):
    """Ticks for a while, with soil readings so the cube stays fresh. Returns (time, commands)."""
    cmds = []
    for i in range(int(seconds / step)):
        t += step
        if i % 4 == 0:
            cmds += e.on_soil_raw("A", C.SOIL_RAW_DRY, t)
        cmds += e.tick(t)
    return t, cmds


class NoPlayerTests(unittest.TestCase):
    def test_dry_soil_calls_no_boss_while_nobody_plays(self):
        e = live()
        t = dry(e, "A", 0.0)
        t, cmds = run(e, t, 600)
        self.assertEqual(e.game.mode, S.WALKING)
        self.assertEqual(cmds, [])

    def test_a_dry_plant_is_flagged_thirsty_for_the_notification(self):
        e = live()
        self.assertEqual(e.snapshot()["thirsty"], {"A": False, "B": False})
        dry(e, "A", 0.0)
        self.assertEqual(e.snapshot()["thirsty"], {"A": True, "B": False})

    def test_soil_is_none_until_a_real_reading_arrives(self):
        e = live()
        self.assertEqual(e.snapshot()["soil"], {"A": None, "B": None})
        e.on_soil_raw("B", C.SOIL_RAW_WET, 0.0)
        self.assertEqual(e.snapshot()["soil"]["B"], 100.0)

    def test_the_live_server_never_auto_plays(self):
        import main
        self.assertFalse(main.make_engine().auto_play)


class PlayerTests(unittest.TestCase):
    def into_battle(self, e):
        e.manual = True
        t = dry(e, "A", 0.0)
        self.assertEqual(e.game.mode, S.BOSS)
        t, _ = run(e, t, C.BOSS_INTRO_SECONDS + 1)
        self.assertIsNotNone(e.battle)
        return t

    def test_a_player_opening_the_game_meets_the_waiting_boss(self):
        e = live()
        t = dry(e, "A", 0.0)
        self.assertEqual(e.game.mode, S.WALKING)
        e.manual = True
        e.on_soil_raw("A", C.SOIL_RAW_DRY, t)
        self.assertEqual(e.game.mode, S.BOSS)

    def test_turns_only_happen_on_the_players_moves(self):
        e = live()
        t = self.into_battle(e)
        t, cmds = run(e, t, 300)   # the player is there but picks nothing for 5 minutes
        self.assertEqual(e.battle.turn, 0)
        self.assertEqual(e.game.mode, S.BATTLE)
        self.assertEqual(cmds, [])

    def test_only_a_players_win_waters_the_plant(self):
        e = live()
        with mock.patch.object(C, "BOSS_TIERS", WEAK_BOSS):
            t = self.into_battle(e)
            cmds = []
            for _ in range(50):
                if e.game.mode != S.BATTLE:
                    break
                t, more = run(e, t, C.BATTLE_TURN_SECONDS + 0.5)
                cmds += more + e.on_player_move("attack", t)
            self.assertEqual(cmds, [])   # the boss is dead, but the victory screen plays first
            t, more = run(e, t, C.REWARD_DISPLAY_SECONDS + 1)
            cmds += more
        self.assertEqual([(c.topic, c.payload) for c in cmds],
                         [(C.TOPIC_CMD_PUMP.format(plant="A"), str(C.PUMP_MS_BY_TIER[e.last_reward["tier"]]))])

    def test_a_fight_left_alone_waits_then_the_boss_leaves_without_water(self):
        e = live()
        t = self.into_battle(e)
        e.manual = False   # every screen closed
        t, cmds = run(e, t, C.BOSS_ABANDON_SECONDS - 5)
        self.assertEqual(e.game.mode, S.BATTLE)   # still waiting
        e.manual = True    # the player comes back in time: nothing was lost
        t, _ = run(e, t, 1)
        e.manual = False
        t, more = run(e, t, C.BOSS_ABANDON_SECONDS + 5)
        self.assertNotIn(e.game.mode, (S.BOSS, S.BATTLE))
        self.assertIsNone(e.battle)
        self.assertEqual(cmds + more, [])


class CooldownTests(unittest.TestCase):
    def won_fight(self):
        e = live()
        e.manual = True
        with mock.patch.object(C, "BOSS_TIERS", WEAK_BOSS):
            t = PlayerTests.into_battle(self, e)
            while e.game.mode == S.BATTLE:
                t, _ = run(e, t, C.BATTLE_TURN_SECONDS + 0.5)
                e.on_player_move("attack", t)
        t, _ = run(e, t, C.REWARD_DISPLAY_SECONDS + 1)   # back in the forest
        return e, t

    def test_no_boss_for_ten_minutes_after_a_fight_even_with_dry_soil(self):
        e, t = self.won_fight()
        t, _ = run(e, t, 590 - C.REWARD_DISPLAY_SECONDS - 1)   # soil A stays bone dry all along
        self.assertNotIn(e.game.mode, (S.BOSS, S.BATTLE))
        t, _ = run(e, t, 20)
        self.assertIn(e.game.mode, (S.BOSS, S.BATTLE))         # ten minutes on: the next boss

    def test_the_demo_button_skips_the_cooldown(self):
        e, t = self.won_fight()
        e.on_demo_boss(t, "A")
        self.assertEqual(e.game.mode, S.BOSS)


if __name__ == "__main__":
    unittest.main()
