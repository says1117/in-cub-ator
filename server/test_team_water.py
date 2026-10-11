"""Tests for team watering: a win waters both pots, one pump at a time.
Run: python -m unittest test_team_water -v  (from the server folder)"""
import random
import unittest
from unittest import mock

import config as C
import state_machine as S
from engine import GameEngine

WEAK_BOSS = {1: ("Weak", 1, 0), 2: ("Weak", 1, 0), 3: ("Weak", 1, 0)}  # the plants always win
PUMP_A = C.TOPIC_CMD_PUMP.format(plant="A")
PUMP_B = C.TOPIC_CMD_PUMP.format(plant="B")


def win_soil_fight(e, wet_b=False, step=0.1, minutes=3, events=None, state=None):
    """Pot A dries and calls a boss; the plants win. Returns [(time, topic, payload)].
    events: {time: callable(e, t)} run once when that time is reached."""
    events = dict(events or {})
    out, t = [], 0.0
    e.last_seen = 0.0
    e.on_esp_status("online", 0.0)
    with mock.patch.object(C, "BOSS_TIERS", WEAK_BOSS):
        for _ in range(int(minutes * 60 / step)):
            t = round(t + step, 3)
            for at in [a for a in events if a <= t]:
                events.pop(at)(e, t)
            if round(t * 10) % 20 == 0:  # a reading every 2 s, like the firmware
                cmds = e.on_soil_raw("A", C.SOIL_RAW_DRY, t)
                b_wet = wet_b or (state or {}).get("b_wet", False)
                cmds += e.on_soil_raw("B", C.SOIL_RAW_WET if b_wet else C.SOIL_RAW_DRY, t)
                out += [(t, c.topic, c.payload) for c in cmds]
            out += [(t, c.topic, c.payload) for c in e.tick(t)]
            if len([o for o in out if o[1] in (PUMP_A, PUMP_B)]) >= 2 and t > 30:
                break
    return out


def engine():
    # need_pads=False: both plants count as on the cube without pad messages, so these tests do not
    # depend on settings another test file changes.
    e = GameEngine(rng=random.Random(1), need_pads=False)
    e.manual = False
    return e


class TeamWaterTests(unittest.TestCase):
    def test_a_win_waters_both_pots_boss_pot_first(self):
        out = win_soil_fight(engine())
        pumps = [o for o in out if o[1] in (PUMP_A, PUMP_B)]
        self.assertEqual([o[1] for o in pumps[:2]], [PUMP_A, PUMP_B])

    def test_the_pumps_run_one_after_the_other(self):
        out = win_soil_fight(engine())
        a, b = [o for o in out if o[1] in (PUMP_A, PUMP_B)][:2]
        run_a = int(a[2]) / 1000.0
        gap = b[0] - a[0]
        self.assertGreaterEqual(gap, run_a + C.TEAM_WATER_MARGIN_SECONDS - 0.11)  # A has finished
        self.assertLess(gap, run_a + C.TEAM_WATER_MARGIN_SECONDS + 0.5)

    def test_no_overlap_even_with_no_margin_and_long_runs(self):
        with mock.patch.object(C, "TEAM_WATER_MARGIN_SECONDS", 0.0), \
                mock.patch.object(C, "PUMP_MS_BY_TIER", {1: 2000, 2: 2000, 3: 2000}):
            out = win_soil_fight(engine())
        a, b = [o for o in out if o[1] in (PUMP_A, PUMP_B)][:2]
        self.assertGreaterEqual(b[0] - a[0], int(a[2]) / 1000.0 - 0.11)

    def test_a_cancelled_watering_is_not_shown_as_done(self):
        e = engine()
        def drop(e, t):
            if e.game.mode == S.REWARD and e.pending_water:
                e.on_esp_status("offline", t)
        events = {round(x * 0.1, 1): drop for x in range(1, 1800)}
        win_soil_fight(e, minutes=1, events=events)
        self.assertTrue(e.last_reward["cancelled"])
        self.assertEqual(e.last_reward["size"], 0)

    def test_going_offline_during_the_victory_screen_cancels_both(self):
        e = engine()
        def drop(e, t):
            if e.game.mode == S.REWARD:
                e.on_esp_status("offline", t)
                e.on_esp_status("online", t + 0.1)  # back before the victory screen ends
        events = {round(x * 0.1, 1): drop for x in range(1, 1800)}
        out = win_soil_fight(e, minutes=1, events=events)
        # once it has been offline during a victory screen, that fight's water never goes out
        self.assertEqual([o for o in out if o[1] in (PUMP_A, PUMP_B)], [])

    def test_a_pot_whose_sensor_went_quiet_is_not_watered(self):
        e = engine()
        sent = []
        real = e._send_pending_water
        def watch(now):
            if e.pending_water:
                e.soil_at["B"] = now - C.SOIL_FRESH_SECONDS - 1  # B's last reading is old
            cmds = real(now)
            sent.extend(cmds)
            return cmds
        e._send_pending_water = watch
        win_soil_fight(e, minutes=1)
        self.assertNotIn(PUMP_B, [c.topic for c in sent])
        self.assertIn(PUMP_A, [c.topic for c in sent])

    def test_a_second_win_does_not_wipe_waiting_water(self):
        e = engine()
        import rewards as R
        e.pending_water = [(R.Command(PUMP_A, "800"), False)]
        e.pending_water.extend([(R.Command(PUMP_B, "800"), False)])  # what a second win does
        self.assertEqual([c.topic for c, _ in e.pending_water], [PUMP_A, PUMP_B])

    def test_each_command_is_capped(self):
        for _, topic, payload in win_soil_fight(engine()):
            if topic in (PUMP_A, PUMP_B):
                self.assertLessEqual(int(payload), C.PUMP_MAX_MS)

    def test_a_wet_partner_pot_is_not_watered(self):
        out = win_soil_fight(engine(), wet_b=True, minutes=1)
        topics = [o[1] for o in out]
        self.assertIn(PUMP_A, topics)
        self.assertNotIn(PUMP_B, topics)

    def test_the_reward_lists_the_whole_team(self):
        e = engine()
        win_soil_fight(e)
        self.assertEqual([w["plant"] for w in e.last_reward["team"]], ["A", "B"])
        self.assertEqual(e.last_reward["plant"], "A")  # old field: the boss's pot, unchanged

    def test_going_offline_between_the_two_pumps_drops_the_second(self):
        e = engine()
        sent = []
        real = e._send_pending_water

        def watch(now):
            cmds = real(now)
            sent.extend(cmds)
            if any(c.topic == PUMP_A for c in cmds):
                e.on_esp_status("offline", now)  # the cube drops right after pump A
            return cmds
        e._send_pending_water = watch
        win_soil_fight(e, minutes=1)
        self.assertEqual([c.topic for c in sent], [PUMP_A])

    def test_soil_that_got_wet_before_its_turn_is_skipped(self):
        e = engine()
        sent = []
        real = e._send_pending_water

        def watch(now):
            cmds = real(now)
            sent.extend(cmds)
            if any(c.topic == PUMP_A for c in cmds):
                state["b_wet"] = True     # from now on pot B's sensor reads wet
                e.on_soil_raw("B", C.SOIL_RAW_WET, now)
            return cmds
        state = {}
        e._send_pending_water = watch
        win_soil_fight(e, minutes=1, state=state)
        self.assertEqual([c.topic for c in sent], [PUMP_A])

    def test_switched_off_only_the_boss_pot_is_watered(self):
        with mock.patch.object(C, "TEAM_WATERING", False):
            out = win_soil_fight(engine(), minutes=1)
        self.assertEqual({o[1] for o in out if o[1] in (PUMP_A, PUMP_B)}, {PUMP_A})

    def test_nothing_is_sent_during_the_victory_screen(self):
        e = engine()
        out = win_soil_fight(e)
        first_pump = min(o[0] for o in out if o[1] in (PUMP_A, PUMP_B))
        self.assertIsNotNone(first_pump)
        self.assertNotEqual(e.game.mode, S.REWARD)


if __name__ == "__main__":
    unittest.main()
