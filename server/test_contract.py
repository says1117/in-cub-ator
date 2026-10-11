"""Turn contract, battle rules, pump safety, persistence and protocol. Stdlib only.
Runs as part of `python3 test_server.py`; on its own: `python3 -m unittest test_contract`."""
import json
import os
import random
import shutil
import tempfile
import unittest
from collections import Counter
from dataclasses import replace
from unittest import mock

import api
import battle as B
import config as C
import main
import persist
import protocol
import rewards as R
import state_machine as S
from engine import GameEngine

DRY_RAW = C.SOIL_RAW_DRY
WET_RAW = C.SOIL_RAW_WET
RAW_40 = round(C.SOIL_RAW_DRY + (C.SOIL_RAW_WET - C.SOIL_RAW_DRY) * 0.40)   # 40%: tier 1, dry
HOUR = C.PUMP_BUDGET_WINDOW_SECONDS


def battle_engine(seed=1, manual=True, plant="A", raw=RAW_40):
    """An engine in the first turn of a demo fight. Both plants have fresh readings."""
    e = GameEngine(rng=random.Random(seed))
    e.manual = manual
    for p in C.PLANTS:
        e.on_soil_raw(p, raw if p == plant else WET_RAW, 0.0)
    e.on_demo_boss(0.0, plant)
    t = C.BOSS_INTRO_SECONDS + 0.1
    e.tick(t)
    assert e.game.mode == S.BATTLE and e.battle is not None
    return e, t + 1.0


def fresh(e, t, plant="A"):
    """The sensors report again: plant dry-ish, the other wet."""
    for p in C.PLANTS:
        e.on_soil_raw(p, RAW_40 if p == plant else WET_RAW, t)


def win_now(e, t):
    """The boss is on 1 HP and the skill finishes it."""
    e.battle = replace(e.battle, boss_hp=1, skill_ready_in=0)
    return e.on_player_move("skill", t, e.battle.turn)


# --------------------------------------------------------------------- battle rules (pure)
class IntentTests(unittest.TestCase):
    def test_a_shown_intent_is_always_the_move_the_boss_plays(self):
        shown = hidden = 0
        for seed in range(300):
            rng = random.Random(seed)
            b = B.roll_intent(B.start(B.plant_fighter("A"), B.boss_for_tier(2), show_rate=0.65), rng)
            while B.winner(b) is None:
                intent = b.intent
                b = B.play_turn(b, rng, rng.choice(B.PLAYER_MOVES))
                if intent is None:
                    hidden += 1
                else:
                    shown += 1
                    self.assertEqual(b.last_move["boss"], intent)
        self.assertAlmostEqual(shown / (shown + hidden), 0.65, delta=0.03)

    def test_the_boss_still_picks_uniformly(self):
        rng = random.Random(7)
        b = B.start(B.Stats(hp=10 ** 9), B.Stats(hp=10 ** 9, atk=0, skill=""), show_rate=0.75)
        counts = Counter()
        for _ in range(30000):
            b = B.play_turn(b, rng, "guard")
            counts[b.last_move["boss"]] += 1
        for move in B.MOVES:
            self.assertAlmostEqual(counts[move] / 30000, 1 / 3, delta=0.012)

    def test_counter_beats_the_intent(self):
        for move in B.MOVES:
            self.assertEqual(B.BEATS[B.COUNTER[move]], move)

    def test_no_intent_once_the_fight_is_over(self):
        b = B.roll_intent(B.start(B.Stats(atk=50), B.Stats(hp=10, atk=1, skill=""), show_rate=1.0),
                          random.Random(1))
        b = B.play_turn(b, random.Random(1), "skill")   # thorn burst: always lands, 50 dmg
        self.assertEqual(B.winner(b), "creature")
        self.assertIsNone(b.intent)
        self.assertEqual(b.boss_next, "")


class BloomTests(unittest.TestCase):
    def fight(self, skill="thorn_burst", atk=8, hp=30):
        return B.start(B.Stats(name="T", hp=hp, atk=atk, skill=skill), B.Stats(name="b", hp=100, atk=6, skill=""))

    def test_a_win_adds_a_bloom_up_to_three(self):
        b = self.fight()
        for expected in (1, 2, 3, 3):
            b = B.resolve_turn(b, "attack", "special")
            self.assertEqual(b.blooms, expected)
        self.assertEqual(b.last_move["bloom_gain"], 0)          # already full

    def test_a_boss_hit_wipes_them_and_a_tie_keeps_them(self):
        b = replace(self.fight(), blooms=2)
        b = B.resolve_turn(b, "attack", "attack")
        self.assertEqual(b.blooms, 2)
        b = B.resolve_turn(b, "special", "attack")
        self.assertEqual((b.blooms, b.last_move["bloom_gain"], b.last_move["taken"]), (0, -2, 6))

    def test_the_skill_spends_them_for_half_again_each(self):
        b = replace(self.fight(atk=7), blooms=1)
        self.assertEqual(B.skill_power(b), 11)                 # 7 x 1.5 = 10.5, rounded half up
        b = B.resolve_turn(b, B.SKILL, "guard")
        self.assertEqual((b.last_move["dealt"], b.last_move["blooms_spent"], b.blooms), (11, 1, 0))
        self.assertEqual(b.boss_hp, 100 - 11)
        self.assertEqual(B.skill_power(replace(self.fight(), blooms=3)), 20)   # 8 x 2.5

    def test_base_skills_are_unchanged_and_round_half_up(self):
        self.assertEqual(B.skill_power(self.fight("bark_shield", atk=7)), 4)    # 3.5 -> 4
        self.assertEqual(B.skill_power(self.fight("bark_shield", atk=5)), 3)    # 2.5 -> 3, not 2
        self.assertEqual(B.skill_power(self.fight("photosynthesis")), 8)
        self.assertEqual(B.skill_power(replace(self.fight("photosynthesis"), blooms=2)), 16)

    def test_a_heal_never_overfills(self):
        b = replace(self.fight("photosynthesis"), creature_hp=27, blooms=3)
        b = B.resolve_turn(b, B.SKILL, "guard")
        self.assertEqual((b.last_move["healed"], b.creature_hp), (3, 30))

    def test_a_swap_resets_blooms(self):
        b = B.start(B.plant_fighter("A"), B.boss_for_tier(1), plant="A", bench=[("B", B.plant_fighter("B"))])
        b = replace(b, creature_hp=1, blooms=3, skill_ready_in=2)
        b = B.resolve_turn(b, "special", "attack")
        self.assertEqual((b.plant, b.blooms, b.skill_ready_in), ("B", 0, 0))
        self.assertEqual(b.last_move["taken"], 1)              # only the HP it had left

    def test_every_turn_reports_dealt_taken_healed(self):
        b = B.resolve_turn(self.fight(), "attack", "attack")
        for key in ("dealt", "taken", "healed", "blooms_spent", "bloom_gain", "hit"):
            self.assertIn(key, b.last_move)


class AutopilotTests(unittest.TestCase):
    def test_never_heals_at_full_hp(self):  # P9
        b = B.start(B.plant_fighter("B"), B.boss_for_tier(1), show_rate=0.0)
        b = replace(b, blooms=3, intent=None, boss_next="guard")
        for seed in range(200):
            self.assertNotEqual(B.auto_move(b, random.Random(seed)), B.SKILL)

    def test_heals_when_most_of_it_lands(self):
        b = replace(B.start(B.plant_fighter("B"), B.boss_for_tier(1)), blooms=1, creature_hp=10, intent=None)
        self.assertEqual(B.auto_move(b, random.Random(1)), B.SKILL)

    def test_finishes_the_boss_with_the_skill(self):
        b = replace(B.start(B.plant_fighter("A"), B.boss_for_tier(1)), boss_hp=5, intent="guard")
        self.assertEqual(B.auto_move(b, random.Random(1)), B.SKILL)

    def test_a_shown_attack_is_not_answered_with_an_unblocked_skill(self):
        b = replace(B.start(B.plant_fighter("A"), B.boss_for_tier(1)), boss_hp=5, blooms=2, intent="attack")
        for seed in range(100):
            self.assertIn(B.auto_move(b, random.Random(seed)), B.MOVES)


# --------------------------------------------------------------------- turn contract (engine)
class TurnContractTests(unittest.TestCase):
    def test_accepting_move_is_honest_about_the_lockout(self):  # P3
        e, t = battle_engine()
        self.assertTrue(e.snapshot(t)["battle"]["accepting_move"])
        e.on_player_move("attack", t, 0)
        self.assertEqual(e.battle.turn, 1)
        during = t + C.BATTLE_TURN_SECONDS - 0.1
        snap = e.snapshot(during)["battle"]
        self.assertFalse(snap["accepting_move"])
        self.assertNotIn("awaiting_move", snap)
        self.assertIsNone(snap["move_deadline_in_ms"])
        e.on_player_move("guard", during, 1)                   # sent anyway: dropped, not queued
        self.assertEqual(e.battle.turn, 1)
        after = t + C.BATTLE_TURN_SECONDS + 0.01
        self.assertTrue(e.snapshot(after)["battle"]["accepting_move"])
        e.on_player_move("guard", after, 1)
        self.assertEqual(e.battle.turn, 2)

    def test_countdown_is_measured_from_now(self):  # P2
        e, t = battle_engine()
        e.on_player_move("attack", t, 0)
        extra = 0.0
        if e.battle.last_move.get("swap"):
            extra = C.SWAP_EXTRA_SECONDS
        ready = t + C.BATTLE_TURN_SECONDS + extra
        left = e.snapshot(ready)["battle"]["move_deadline_in_ms"]
        expected = (C.PLAYER_MOVE_TIMEOUT_SECONDS - C.BATTLE_TURN_SECONDS) * 1000
        self.assertAlmostEqual(left, expected, delta=1)
        self.assertLessEqual(left, C.PLAYER_MOVE_TIMEOUT_SECONDS * 1000)
        self.assertAlmostEqual(e.snapshot(ready + 1.0)["battle"]["move_deadline_in_ms"], expected - 1000, delta=1)

    def test_a_move_for_another_turn_is_dropped(self):
        e, t = battle_engine()
        self.assertEqual(e.on_player_move("attack", t, 5), [])
        self.assertEqual(e.battle.turn, 0)
        e.on_player_move("attack", t, -1)                      # a junk tag never matches
        self.assertEqual(e.battle.turn, 0)
        e.on_player_move("attack", t, 0)
        self.assertEqual(e.battle.turn, 1)

    def test_a_move_without_a_turn_tag_is_accepted(self):
        e, t = battle_engine()
        e.on_player_move("attack", t)
        self.assertEqual(e.battle.turn, 1)

    def test_a_timeout_makes_the_game_idle_and_any_move_message_wakes_it(self):
        e, t = battle_engine()
        deadline = e.move_deadline
        e.tick(deadline + 0.01)
        self.assertEqual(e.battle.turn, 1)
        self.assertTrue(e.idle)
        snap = e.snapshot(deadline + 0.01)["battle"]
        self.assertTrue(snap["autopilot"])
        self.assertTrue(snap["last_move"]["auto"])
        # idle: the next turn comes after AUTO_TURN_SECONDS, not the full player timeout
        e.tick(deadline + 0.01 + C.AUTO_TURN_SECONDS + C.SWAP_EXTRA_SECONDS + 3 * C.UNLEASH_EXTRA_SECONDS_PER_BLOOM + 0.01)
        self.assertEqual(e.battle.turn, 2)
        # junk is not a person: an invalid move name does not wake it
        now = e.move_ready_at - 0.5
        for junk in ("", "dance", "ATTACK"):
            e.on_player_move(junk, now, e.battle.turn)
        self.assertTrue(e.idle)
        # a valid move with a wrong turn (here 99) wakes it and is dropped
        e.on_player_move("attack", now, 99)
        self.assertFalse(e.idle)
        self.assertEqual(e.battle.turn, 2)
        self.assertGreaterEqual(e.move_deadline, now + C.PLAYER_MOVE_TIMEOUT_SECONDS)
        self.assertFalse(e.snapshot(now)["battle"]["autopilot"])

    def test_take_over_press_with_turn_minus_one_during_the_lockout(self):
        """While its buttons are locked the client sends turn -1: "I'm here, this is not a move"."""
        e, t = battle_engine()
        e.tick(e.move_deadline + 0.01)                         # times out: autopilot
        self.assertTrue(e.idle)
        during = e.move_ready_at - 0.3                          # inside the lockout
        message = protocol.parse_client_message('{"action":"move","move":"guard","turn":-1}')
        main.route(e, message[0], message[1], during)
        self.assertFalse(e.idle)                                # taken over
        self.assertEqual(e.battle.turn, 1)                      # but nothing was played
        self.assertFalse(e.snapshot(during)["battle"]["autopilot"])
        self.assertGreaterEqual(e.move_deadline, during + C.PLAYER_MOVE_TIMEOUT_SECONDS)
        e.tick(e.move_ready_at + C.AUTO_TURN_SECONDS)           # no autopilot turn at the fast pace
        self.assertEqual(e.battle.turn, 1)
        main.route(e, message[0], json.dumps({"move": "guard", "turn": -1}), e.move_ready_at + 0.1)
        self.assertEqual(e.battle.turn, 1)                      # -1 never plays, even when unlocked

    def test_no_screen_means_autopilot_at_the_auto_pace(self):
        e, t = battle_engine(manual=False)
        start = C.BOSS_INTRO_SECONDS + 0.1
        e.tick(start + C.AUTO_TURN_SECONDS - 0.1)
        self.assertEqual(e.battle.turn, 0)
        e.tick(start + C.AUTO_TURN_SECONDS + 0.01)
        self.assertEqual(e.battle.turn, 1)
        self.assertTrue(e.snapshot()["battle"]["autopilot"])
        self.assertFalse(e.snapshot()["battle"]["accepting_move"])

    def test_a_screen_connecting_mid_fight_gets_the_full_timeout(self):
        e, t = battle_engine(manual=False)
        e.set_manual(True, t)
        self.assertGreaterEqual(e.move_deadline, t + C.PLAYER_MOVE_TIMEOUT_SECONDS)

    def test_swaps_and_unleashed_skills_lock_out_longer(self):
        e, t = battle_engine()
        e.battle = replace(e.battle, creature_hp=1, boss_next="attack", intent=None)
        e.on_player_move("special", t, 0)                      # attack beats special: A faints
        self.assertIn("swap", e.battle.last_move)
        self.assertAlmostEqual(e.move_ready_at, t + C.BATTLE_TURN_SECONDS + C.SWAP_EXTRA_SECONDS)
        t2 = e.move_ready_at
        e.battle = replace(e.battle, blooms=2, skill_ready_in=0, boss_next="guard")
        e.on_player_move("skill", t2, e.battle.turn)
        self.assertEqual(e.battle.last_move["blooms_spent"], 2)
        self.assertAlmostEqual(e.move_ready_at, t2 + C.BATTLE_TURN_SECONDS + 2 * C.UNLEASH_EXTRA_SECONDS_PER_BLOOM)


class ResultTests(unittest.TestCase):
    def test_the_losing_turn_is_shown_when_the_timer_picks_it(self):  # P1
        e, t = battle_engine()
        e.battle = replace(e.battle, creature_hp=1, bench=(), boss_next="attack", intent=None, skill_ready_in=2)
        with mock.patch("battle.auto_move", return_value="special"):
            e.tick(e.move_deadline + 0.01)
        snap = e.snapshot()
        self.assertEqual(snap["mode"], S.COOLDOWN)
        self.assertIsNotNone(snap["battle"])                    # still there for the screen
        self.assertTrue(snap["battle"]["over"])
        self.assertEqual(snap["battle"]["creature_hp"], 0)
        self.assertEqual(snap["battle"]["last_move"]["boss"], "attack")
        self.assertIsNotNone(snap["boss"])                      # the boss stays with the fight
        self.assertIsNone(snap["battle"]["intent"])
        self.assertFalse(snap["battle"]["accepting_move"])
        self.assertEqual((snap["result"]["outcome"], snap["result"]["fight"]), ("lost", snap["battle"]["id"]))

    def test_the_finished_fight_is_held_then_cleared(self):
        e, t = battle_engine()
        e.battle = replace(e.battle, creature_hp=1, bench=(), boss_next="attack", intent=None)
        e.on_player_move("special", t, 0)                      # lost by a button press
        self.assertTrue(e.snapshot(t)["battle"]["over"])
        e.tick(t + C.RESULT_HOLD_SECONDS - 0.1)
        self.assertIsNotNone(e.battle)
        e.tick(t + C.RESULT_HOLD_SECONDS + 0.01)
        self.assertIsNone(e.battle)
        self.assertIsNone(e.snapshot()["boss"])
        self.assertEqual(e.snapshot()["result"]["outcome"], "lost")   # the result stays

    def test_a_win_is_held_too_and_reports_the_real_water(self):
        e, t = battle_engine()
        cmds = win_now(e, t)
        self.assertEqual(len(cmds), 1)
        snap = e.snapshot(t)
        self.assertEqual(snap["mode"], S.REWARD)
        self.assertTrue(snap["battle"]["over"])
        self.assertEqual(snap["result"], {"fight": snap["battle"]["id"], "outcome": "won", "plant": "A",
                                          "water_ms": int(cmds[0].payload), "blocked": None})

    def test_a_blocked_reward_never_shows_the_previous_one(self):  # P7
        e, t = battle_engine()
        first = win_now(e, t)
        self.assertEqual(len(first), 1)
        t += C.RESULT_HOLD_SECONDS + C.REWARD_DISPLAY_SECONDS + 1
        e.tick(t)
        fresh(e, t)
        e.on_demo_boss(t, "A")                                 # again, inside the pump gap
        t += C.BOSS_INTRO_SECONDS + 0.1
        e.tick(t)
        fresh(e, t)
        t += 1.0
        self.assertEqual(win_now(e, t), [])
        result = e.snapshot(t)["result"]
        self.assertEqual((result["outcome"], result["water_ms"], result["blocked"]), ("won", 0, R.PUMP_RESTING))
        self.assertEqual(result["fight"], e.fight["id"])

    def test_no_demo_while_a_result_is_on_screen(self):
        for lose in (False, True):
            e, t = battle_engine()
            if lose:
                e.battle = replace(e.battle, creature_hp=1, bench=(), boss_next="attack", intent=None)
                e.on_player_move("special", t, 0)
                self.assertEqual(e.game.mode, S.COOLDOWN)       # cooldown, but the fight is still shown
            else:
                win_now(e, t)
                self.assertEqual(e.game.mode, S.REWARD)
            self.assertFalse(e.snapshot(t)["demo_available"])
            fid = e.fight["id"]
            e.on_demo_boss(t + 0.5, "B")
            self.assertEqual(e.fight["id"], fid)                # the result was not cut short
            self.assertNotEqual(e.game.mode, S.BOSS)
            end = t + max(C.RESULT_HOLD_SECONDS, C.REWARD_DISPLAY_SECONDS) + 0.01
            e.tick(end)
            self.assertTrue(e.snapshot(end)["demo_available"])
            e.on_demo_boss(end, "B")
            self.assertEqual(e.game.mode, S.BOSS)

    def test_a_dismissed_fight_says_so(self):
        e, t = battle_engine()
        e.on_esp_status("offline", t)
        snap = e.snapshot(t)
        self.assertEqual(snap["result"]["outcome"], "dismissed")
        self.assertTrue(snap["battle"]["over"])

    def test_fight_ids_are_six_hex_and_differ(self):
        ids = set()
        for seed in range(20):
            e, _ = battle_engine(seed=seed)
            fid = e.snapshot()["battle"]["id"]
            self.assertRegex(fid, r"^[0-9a-f]{6}$")
            ids.add(fid)
        self.assertGreater(len(ids), 15)

    def test_stats_count_fights_wins_and_water(self):
        e, t = battle_engine()
        e.set_today("2026-10-11")
        e.stats["fights"] = 1          # set_today reset the counter of the fight already running
        cmds = win_now(e, t)
        self.assertEqual(e.snapshot(t)["stats"], {"fights": 1, "wins": 1, "waterings": 1,
                                                  "water_ms": int(cmds[0].payload)})
        e.set_today("2026-10-12")
        self.assertEqual(e.snapshot(t)["stats"], {"fights": 0, "wins": 0, "waterings": 0, "water_ms": 0})


class SnapshotTests(unittest.TestCase):
    BATTLE_KEYS = {"id", "turn", "plant", "team", "creature", "creature_hp", "creature_max_hp", "boss_hp",
                   "intent", "blooms", "blooms_max", "skill", "last_move", "manual", "autopilot",
                   "accepting_move", "move_deadline_in_ms", "over"}

    def test_the_secret_next_move_is_never_serialized(self):
        for seed in range(40):
            e, t = battle_engine(seed=seed, manual=seed % 2 == 0)
            for _ in range(60):
                t += 0.5
                if e.battle is not None:
                    fresh(e, t)
                e.tick(t)
                text = protocol.encode(e.snapshot(t))
                self.assertNotIn("boss_next", text)
                snap = json.loads(text)
                if snap["battle"]:
                    self.assertEqual(set(snap["battle"]), self.BATTLE_KEYS)
                    if snap["battle"]["last_move"]:
                        self.assertNotIn("boss_next", snap["battle"]["last_move"])

    def test_a_shown_intent_in_the_snapshot_equals_the_next_boss_move(self):
        checked = 0
        for seed in range(60):
            e, t = battle_engine(seed=seed)
            while e.battle is not None and not e.fight["over_at"]:
                t = max(t, e.move_ready_at)
                shown = e.snapshot(t)["battle"]["intent"]["move"]
                turn = e.battle.turn
                e.on_player_move(random.Random(seed + turn).choice(B.PLAYER_MOVES), t, turn)
                if shown is not None:
                    self.assertEqual(e.snapshot(t)["battle"]["last_move"]["boss"], shown)
                    checked += 1
                fresh(e, t)
        self.assertGreater(checked, 200)

    def test_skill_block_describes_the_skill(self):
        e, _ = battle_engine()
        skill = e.snapshot()["battle"]["skill"]
        self.assertEqual(skill, {"id": "thorn_burst", "name": "Thorn Burst", "kind": "damage",
                                 "power": C.PLANT_FIGHTERS["A"]["atk"], "ready": True, "ready_in": 0})

    def test_top_level_fields(self):
        e = GameEngine()
        snap = e.snapshot()
        self.assertEqual(snap["v"], 2)
        self.assertTrue(snap["demo_available"])
        self.assertIsInstance(snap["health"], int)
        self.assertEqual(snap["meters"]["thirsty"], {"A": False, "B": False})
        e.on_demo_boss(0.0, "A")
        self.assertFalse(e.snapshot()["demo_available"])
        self.assertIsNotNone(e.snapshot()["boss"])
        self.assertIsNone(e.snapshot()["battle"])


# --------------------------------------------------------------------- pump safety
class PumpSafetyTests(unittest.TestCase):
    def decide(self, pct=10.0, now=10000.0, pumps=(), fresh=True, demo=False, tier=1):
        return R.water_decision("A", pct, now, pumps, fresh=fresh, demo=demo, tier=tier)

    def test_dry_soil_gets_the_tier_amount(self):
        cmd, blocked = self.decide(tier=2)
        self.assertEqual((int(cmd.payload), blocked), (C.PUMP_MS_BY_TIER[2], None))

    def test_no_fresh_reading_means_no_water(self):
        self.assertEqual(self.decide(fresh=False), (None, R.OFFLINE))

    def test_wet_soil_gets_nothing_but_a_demo_gets_a_sip(self):
        self.assertEqual(self.decide(pct=C.SOIL_WET_THRESHOLD_PCT), (None, R.SOIL_WET))
        cmd, _ = self.decide(pct=99.0, demo=True, tier=3)
        self.assertEqual(int(cmd.payload), C.DEMO_SIP_MS)

    def test_the_gap_holds(self):
        now = 10000.0
        self.assertEqual(self.decide(now=now, pumps=[(now - C.REWARD_MIN_GAP_SECONDS + 1, 2000)]),
                         (None, R.PUMP_RESTING))
        self.assertEqual(self.decide(pct=99, demo=True, now=now, pumps=[(now - 1, 500)]), (None, R.PUMP_RESTING))
        self.assertIsNotNone(self.decide(now=now, pumps=[(now - C.REWARD_MIN_GAP_SECONDS - 1, 2000)])[0])

    def test_the_rolling_budget_holds(self):
        now = 10000.0
        used = [(now - 600 * (i + 1), 3000) for i in range(4)]       # 12 s in the last 40 minutes
        self.assertEqual(self.decide(now=now, pumps=used), (None, R.BUDGET))
        old = [(now - HOUR - 1, 3000)] + used[1:]                     # one fell out of the window
        self.assertIsNotNone(self.decide(now=now, pumps=old)[0])
        self.assertEqual(self.decide(now=now, pumps=old[:1] + [(now - 600, 3000)] * 3, tier=3)[0].payload, "3000")

    def test_the_cap_holds_even_if_config_is_too_big(self):
        with mock.patch.object(C, "PUMP_MS_BY_TIER", {t: C.PUMP_MAX_MS * 10 for t in (1, 2, 3)}):
            for tier in (1, 2, 3):
                self.assertEqual(int(self.decide(tier=tier)[0].payload), C.PUMP_MAX_MS)

    def test_a_pump_from_the_future_counts_as_now(self):
        now = 10000.0
        self.assertEqual(self.decide(now=now, pumps=[(now + 5000, 3000)]), (None, R.PUMP_RESTING))
        self.assertEqual(R.pumped_in_window([(now + 99999, 3000)], now), 3000)

    def test_never_heard_from_means_no_pump(self):  # P6
        e = GameEngine(rng=random.Random(1))
        e.on_demo_boss(0.0, "A")
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        e.manual = True
        cmds = win_now(e, C.BOSS_INTRO_SECONDS + 1.0)
        self.assertEqual(cmds, [])
        self.assertEqual(e.result["blocked"], R.OFFLINE)

    def test_a_reading_for_the_other_plant_is_not_enough(self):
        e = GameEngine(rng=random.Random(1))
        e.manual = True
        e.on_soil_raw("B", RAW_40, 0.0)
        e.on_demo_boss(0.0, "A")
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        self.assertEqual(win_now(e, C.BOSS_INTRO_SECONDS + 1.0), [])
        self.assertEqual(e.result["blocked"], R.OFFLINE)

    def test_an_old_reading_is_not_enough(self):
        e, t = battle_engine()
        e.last_seen = t + C.ESP32_STALE_SECONDS     # keep the link "alive" so only the age matters
        late = C.ESP32_STALE_SECONDS + 1
        self.assertEqual(win_now(e, late), [])
        self.assertEqual(e.result["blocked"], R.OFFLINE)

    def test_publish_failure_rolls_everything_back(self):
        e, t = battle_engine()
        e.set_today("d")
        cmds = win_now(e, t)
        self.assertEqual(len(cmds), 1)
        self.assertEqual(len(e.pumps["A"]), 1)
        e.dirty = False
        with self.assertLogs("engine", "WARNING"):
            e.pump_failed(cmds[0], t)
        self.assertEqual(e.pumps["A"], [])
        self.assertEqual((e.stats["waterings"], e.stats["water_ms"]), (0, 0))
        self.assertEqual((e.result["water_ms"], e.result["blocked"]), (0, R.PUBLISH_FAILED))
        self.assertTrue(e.dirty)
        # and the next win is not blocked by a pump that never happened
        t2 = t + C.RESULT_HOLD_SECONDS + C.REWARD_DISPLAY_SECONDS + 1
        e.tick(t2)
        fresh(e, t2)
        e.on_demo_boss(t2, "A")
        e.tick(t2 + C.BOSS_INTRO_SECONDS + 0.1)
        fresh(e, t2 + C.BOSS_INTRO_SECONDS + 0.2)
        self.assertEqual(len(win_now(e, t2 + C.BOSS_INTRO_SECONDS + 1.0)), 1)

    def test_main_reads_the_publish_result(self):
        self.assertTrue(main.published(None))                       # loopback
        self.assertTrue(main.published(mock.Mock(rc=0)))
        self.assertFalse(main.published(mock.Mock(rc=4)))           # MQTT_ERR_NO_CONN

    def test_an_hour_of_demo_presses_stays_inside_the_budget(self):
        e = GameEngine(rng=random.Random(5))
        e.manual = True
        t, total = 0.0, 0
        while t < HOUR:
            fresh_t = t
            for p in C.PLANTS:
                e.on_soil_raw(p, DRY_RAW, fresh_t)
            e.on_demo_boss(t, "A")
            e.tick(t + C.BOSS_INTRO_SECONDS + 0.1)
            if e.battle is not None and not e.fight["over_at"]:
                total += sum(int(c.payload) for c in win_now(e, t + C.BOSS_INTRO_SECONDS + 1.0))
            t += 61.0
            e.tick(t)
        self.assertLessEqual(total, C.PUMP_BUDGET_MS_PER_HOUR)
        self.assertGreater(total, 0)


# --------------------------------------------------------------------- persistence
class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "var", "pump_log.json")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_round_trip_keeps_the_gap_and_the_budget_across_a_restart(self):
        e, t = battle_engine()
        e.set_today("2026-10-11")
        win_now(e, t)
        persist.save(self.path, e.persisted(t), now_wall=1_000_000.0)
        self.assertFalse(os.path.exists(self.path + ".tmp"))
        # a restart 10 s later (wall clock), on a fresh monotonic clock
        data = persist.load(self.path, now_wall=1_000_010.0)
        self.assertEqual(data["status"], persist.OK)
        e2 = GameEngine()
        e2.restore(data, now=5.0)
        self.assertEqual(e2.stats["waterings"], 1)
        self.assertAlmostEqual(e2.pumps["A"][0][0], 5.0 - 10.0, places=2)
        self.assertEqual(R.water_decision("A", 10.0, 5.0, e2.pumps["A"])[1], R.PUMP_RESTING)
        later = 5.0 + C.REWARD_MIN_GAP_SECONDS
        self.assertIsNotNone(R.water_decision("A", 10.0, later, e2.pumps["A"])[0])

    def test_a_missing_file_is_an_empty_log(self):
        data = persist.load(self.path, 0.0)
        self.assertEqual((data["status"], data["pumps"]), (persist.MISSING, {"A": [], "B": []}))

    def test_a_corrupt_file_counts_as_a_full_pump_per_plant_just_now(self):
        for text in ("{not json", "[]", '{"v": 9, "pumps": {}}', '{"v":1,"pumps":{"A":[["x",1]]}}',
                     '{"v":1,"pumps":{"A":[[1e999,1]]}}', '{"v":1,"pumps":{"A":"no"}}', ""):
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path, "w") as f:
                f.write(text)
            with self.assertLogs("persist", "WARNING"):
                data = persist.load(self.path, 50_000.0)
            self.assertEqual(data["status"], persist.CORRUPT, text)
            e = GameEngine()
            e.restore(data, now=100.0)
            for p in C.PLANTS:
                self.assertEqual(R.water_decision(p, 10.0, 100.0, e.pumps[p])[1], R.PUMP_RESTING)
                self.assertEqual(R.pumped_in_window(e.pumps[p], 100.0), C.PUMP_MAX_MS)

    def test_an_unreadable_file_is_corrupt(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "wb") as f:
            f.write(b"\xff\xfe\x00garbage")
        with self.assertLogs("persist", "WARNING"):
            self.assertEqual(persist.load(self.path, 0.0)["status"], persist.CORRUPT)

    def test_a_clock_jump_back_makes_old_pumps_count_as_now(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as f:
            json.dump({"v": 1, "pumps": {"A": [[2_000_000.0, 2500]], "B": []}, "stats": None}, f)
        data = persist.load(self.path, now_wall=1_000_000.0)       # the file is "from the future"
        self.assertEqual(data["pumps"]["A"], [(0.0, 2500)])
        e = GameEngine()
        e.restore(data, now=42.0)
        self.assertEqual(R.water_decision("A", 10.0, 42.0, e.pumps["A"])[1], R.PUMP_RESTING)

    def test_entries_older_than_the_window_are_dropped(self):
        persisted = {"pumps": {"A": [(HOUR + 5, 3000), (30.0, 2000)], "B": []}, "stats": None}
        persist.save(self.path, persisted, now_wall=100_000.0)
        data = persist.load(self.path, 100_000.0)
        self.assertEqual(data["pumps"]["A"], [(30.0, 2000)])

    def test_stats_survive_a_restart_on_the_same_day_only(self):
        e = GameEngine()
        e.set_today("2026-10-11")
        e.stats.update(fights=3, wins=2, waterings=2, water_ms=4500)
        persist.save(self.path, e.persisted(0.0), 1000.0)
        e2 = GameEngine()
        e2.restore(persist.load(self.path, 1001.0), 0.0)
        e2.set_today("2026-10-11")
        self.assertEqual(e2.snapshot()["stats"], {"fights": 3, "wins": 2, "waterings": 2, "water_ms": 4500})
        e2.set_today("2026-10-12")
        self.assertEqual(e2.snapshot()["stats"]["fights"], 0)

    def test_a_failed_save_keeps_the_pump_until_a_save_succeeds(self):
        e, t = battle_engine()
        self.assertEqual(len(win_now(e, t)), 1)
        self.assertTrue(e.dirty)
        with mock.patch("persist.save", side_effect=OSError("disk full")):
            self.assertFalse(main.save_state(e, self.path, t, 1000.0))
        self.assertTrue(e.dirty)                                # still to be written
        self.assertTrue(main.save_state(e, self.path, t + 0.2, 1000.2))
        self.assertFalse(e.dirty)
        self.assertEqual(persist.load(self.path, 1001.0)["pumps"]["A"][0][1], e.pumps["A"][0][1])

    def test_memory_only_runs_never_write(self):
        e, t = battle_engine()
        win_now(e, t)
        with mock.patch("persist.save") as save:
            self.assertTrue(main.save_state(e, "", t, 0.0))
        save.assert_not_called()
        self.assertFalse(e.dirty)

    def test_simulated_runs_never_touch_the_production_log(self):
        production = main.state_path_for([])
        self.assertTrue(production.endswith(os.path.join("var", "pump_log.json")))
        self.assertEqual(main.state_path_for(["--sim"]), "")
        self.assertEqual(main.state_path_for(["--offline"]), "")
        self.assertEqual(main.state_path_for(["--sim", "--state=/tmp/x.json"]), "/tmp/x.json")
        self.assertEqual(main.state_path_for(["--ws-port=8821"]), production)

    def test_the_engine_marks_itself_dirty_when_something_must_be_saved(self):
        e, t = battle_engine()
        e.dirty = False
        win_now(e, t)
        self.assertTrue(e.dirty)


# --------------------------------------------------------------------- hardening + protocol
class RouteTests(unittest.TestCase):
    def test_bad_soil_payloads_are_ignored(self):
        e = GameEngine()
        with self.assertLogs("main", "WARNING"):
            for payload in ("inf", "-inf", "1e999", "nan", "NaN", "abc", "", "  ", None, "1,5"):
                self.assertEqual(main.route(e, "incube/soil/A", payload, 0.0), [], payload)
        self.assertIsNone(e.last_soil_at["A"])
        main.route(e, "incube/soil/A", "2310", 1.0)
        self.assertEqual(e.last_soil_at["A"], 1.0)

    def test_route_never_raises(self):
        e = GameEngine()
        with self.assertLogs("main", "ERROR") as logs:
            with mock.patch.object(e, "on_demo_boss", side_effect=RuntimeError("boom")):
                self.assertEqual(main.route(e, protocol.DEMO_TOPIC, "", 0.0), [])
            for topic, payload in ((None, None), ("incube/pad/A", None), (protocol.MOVE_TOPIC, None),
                                   (protocol.MOVE_TOPIC, "{bad"), (C.TOPIC_DEBUG_BOSS, None), ("x", b"\x00")):
                self.assertEqual(main.route(e, topic, payload, 0.0), [])
        self.assertIn("boom", "\n".join(logs.output))

    def test_route_passes_the_turn_tag(self):
        e, t = battle_engine()
        main.route(e, protocol.MOVE_TOPIC, json.dumps({"move": "attack", "turn": 3}), t)
        self.assertEqual(e.battle.turn, 0)
        main.route(e, protocol.MOVE_TOPIC, json.dumps({"move": "attack", "turn": 0}), t)
        self.assertEqual(e.battle.turn, 1)

    def test_a_dropout_wipes_the_dry_streak(self):  # P11
        e = GameEngine()
        for _ in range(C.SOIL_DRY_READINGS_N):
            e.on_soil_raw("A", DRY_RAW, 0.0)
        self.assertEqual(e.game.mode, S.BOSS)
        e.tick(C.ESP32_STALE_SECONDS + 1)                     # the bridge restarts
        self.assertEqual(e.game.mode, S.WALKING)
        t = C.ESP32_STALE_SECONDS + 2
        e.on_soil_raw("A", DRY_RAW, t)                        # first reading back: no instant boss
        self.assertEqual(e.game.mode, S.WALKING)
        for i in range(C.SOIL_DRY_READINGS_N - 1):
            e.on_soil_raw("A", DRY_RAW, t + i)
        self.assertEqual(e.game.mode, S.BOSS)


class ProtocolTests(unittest.TestCase):
    def test_client_messages(self):
        parse = protocol.parse_client_message
        self.assertEqual(parse('{"action":"demo_boss"}'), (protocol.DEMO_TOPIC, ""))
        topic, payload = parse('{"action":"move","move":"guard","turn":2}')
        self.assertEqual((topic, protocol.parse_move(payload)), (protocol.MOVE_TOPIC, ("guard", 2)))
        self.assertEqual(protocol.parse_move(parse('{"action":"move","move":"guard"}')[1]), ("guard", None))
        self.assertEqual(protocol.parse_move(parse('{"action":"move","move":"guard","turn":-1}')[1]), ("guard", -1))
        self.assertEqual(protocol.parse_move(parse('{"action":"move","move":"guard","turn":"2"}')[1])[1], -1)
        self.assertEqual(protocol.parse_move(parse('{"action":"move","move":7}')[1])[0], "")
        for junk in ("", "nope", "[1,2]", "42", '"move"', "null", '{"action":5}', '{"action":"dance"}', b"\xff"):
            self.assertIsNone(parse(junk), junk)

    def test_a_countdown_alone_never_causes_a_broadcast(self):
        e, t = battle_engine()
        feed = api.Feed(e, queue=None)
        self.assertIsNotNone(feed.next_message(t))
        self.assertIsNone(feed.next_message(t + 0.4))           # only move_deadline_in_ms moved
        e.on_player_move("attack", t + 0.4, 0)
        self.assertIsNotNone(feed.next_message(t + 0.5))        # a turn: broadcast
        self.assertIsNone(feed.next_message(t + 0.6))           # locked out, nothing new
        ready = e.move_ready_at + 0.01
        msg = feed.next_message(ready)                          # accepting flips: broadcast
        self.assertTrue(json.loads(msg)["battle"]["accepting_move"])
        self.assertIsNotNone(json.loads(msg)["battle"]["move_deadline_in_ms"])

    def test_feed_hands_parsed_messages_to_the_queue(self):
        items = []
        feed = api.Feed(GameEngine(), queue=mock.Mock(put_nowait=items.append))
        feed._on_client_message('{"action":"move","move":"attack","turn":1}')
        feed._on_client_message("garbage")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0][0], protocol.MOVE_TOPIC)


if __name__ == "__main__":
    unittest.main()
