"""Run: python -m unittest test_server -v  (from the server folder, no hardware needed)"""
import random
import unittest

import battle as B
import moisture_sim as M
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


def feed_dry_pct(g, pct, plant="A", n=C.SOIL_DRY_READINGS_N, now=0.0):
    for _ in range(n):
        g = S.on_soil(g, plant, pct, now)
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
        old = dict(C.PUMP_MS_BY_TIER)
        C.PUMP_MS_BY_TIER = {t: C.PUMP_MAX_MS * 10 for t in (1, 2, 3)}
        try:
            for tier in (1, 2, 3):
                cmd = R.water_reward("A", 10.0, 1000.0, float("-inf"), tier=tier)
                self.assertEqual(int(cmd.payload), C.PUMP_MAX_MS)
        finally:
            C.PUMP_MS_BY_TIER = old

    def test_harder_boss_gives_more_water_within_the_cap(self):
        ms = [int(R.water_reward("A", 10.0, 1000.0, float("-inf"), tier=t).payload) for t in (1, 2, 3)]
        self.assertEqual(ms, sorted(ms))
        self.assertLess(ms[0], ms[2])
        self.assertTrue(all(m <= C.PUMP_MAX_MS for m in ms))


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


class TierTests(unittest.TestCase):
    def test_tier_for_moisture(self):
        self.assertEqual(S.tier_for(80), 0)
        self.assertEqual(S.tier_for(50), 0)
        self.assertEqual(S.tier_for(49), 1)
        self.assertEqual(S.tier_for(24), 2)
        self.assertEqual(S.tier_for(0), 3)

    def test_over_50_percent_no_boss(self):
        g = S.Game()
        for _ in range(20):
            g = S.on_soil(g, "A", 60.0, 0)
        self.assertEqual(g.mode, S.WALKING)

    def test_boss_tier_matches_dryness_at_spawn(self):
        for pct, tier in [(40.0, 1), (10.0, 2), (0.0, 3)]:
            g = feed_dry_pct(S.Game(), pct)
            self.assertEqual((g.mode, g.tier), (S.BOSS, tier), pct)

    def test_harder_tier_skips_the_cooldown(self):
        g = S.on_tick(feed_dry_pct(S.Game(), 40.0), C.BOSS_INTRO_SECONDS)
        g, _ = S.on_battle_done(g, False, 10.0)            # lost, now in cooldown
        g = feed_dry_pct(g, 40.0, now=11.0)                # same tier: still blocked
        self.assertEqual(g.mode, S.COOLDOWN)
        g = feed_dry_pct(g, 10.0, now=12.0)                # drier: a harder boss comes
        self.assertEqual((g.mode, g.tier), (S.BOSS, 2))

    def test_bosses_get_stronger(self):
        hp = [B.boss_for_tier(t).hp for t in (1, 2, 3)]
        atk = [B.boss_for_tier(t).atk for t in (1, 2, 3)]
        self.assertEqual(hp, sorted(hp))
        self.assertEqual(atk, sorted(atk))
        self.assertLess(hp[0], hp[2])


class BalanceTests(unittest.TestCase):
    def test_every_tier_is_winnable_at_least_40_percent(self):
        for tier in (1, 2, 3):
            wins = 0
            games = 3000
            for seed in range(games):
                rng = random.Random(seed)
                fight = B.start(B.Stats(), B.boss_for_tier(tier))
                while not B.winner(fight):
                    fight = B.play_turn(fight, rng)
                wins += B.winner(fight) == "creature"
            self.assertGreaterEqual(wins / games, 0.40, f"tier {tier}")


class HealthTests(unittest.TestCase):
    def run_for(self, e, seconds, start=0.0):
        t = start
        for _ in range(int(seconds * 2)):
            t += 0.5
            e.tick(t)
        return t

    def test_health_fades_when_dry_and_faster_when_drier(self):
        results = []
        for raw in (WET_RAW, 2700, DRY_RAW):  # chill, tier 1 (~17%)... then bone dry
            e = GameEngine()
            e.tick(0.0)
            e.on_soil_raw("A", raw, 0.0)
            e.game = S.Game(mode=S.COOLDOWN, mode_until=1e9, cooldown_until={"A": 1e9, "B": 1e9})
            self.run_for(e, 10)
            results.append(e.health)
        self.assertEqual(results[0], 100.0)
        self.assertLess(results[1], 100.0)
        self.assertLess(results[2], results[1])

    def test_health_recovers_when_moisture_returns(self):
        e = GameEngine()
        e.health = 40.0
        e.tick(0.0)
        e.on_soil_raw("A", WET_RAW, 0.0)
        self.run_for(e, 10)
        self.assertGreater(e.health, 40.0)

    def test_health_stays_between_0_and_100(self):
        e = GameEngine()
        e.tick(0.0)
        e.on_soil_raw("A", DRY_RAW, 0.0)
        self.run_for(e, 200)
        self.assertGreaterEqual(e.health, 0.0)
        e.on_soil_raw("A", WET_RAW, 0.0)
        e.soil_pct["B"] = 100.0
        self.run_for(e, 100, start=100.0)
        self.assertLessEqual(e.health, 100.0)

    def test_snapshot_has_health_tier_and_boss_name(self):
        e = GameEngine()
        e.on_soil_raw("A", DRY_RAW, 0.0)
        for _ in range(C.SOIL_DRY_READINGS_N):
            e.on_soil_raw("A", DRY_RAW, 0.0)
        snap = e.snapshot()
        self.assertIn("health", snap)
        self.assertEqual(snap["tier"], 3)
        self.assertEqual(snap["boss"]["name"], B.boss_for_tier(3).name)


class SimTests(unittest.TestCase):
    def test_simulated_percentage_stays_in_range_and_moves(self):
        sim = M.MoistureSim(random.Random(7))
        seen = set()
        for _ in range(2000):
            pct = sim.step(1.0)
            self.assertTrue(0.0 <= pct <= 100.0)
            seen.add(S.tier_for(pct))
        self.assertEqual(seen, {0, 1, 2, 3})

    def test_watering_raises_it(self):
        sim = M.MoistureSim(random.Random(1), start=10.0)
        sim.watered(3000)
        self.assertGreater(sim.pct, 40.0)

    def test_raw_matches_the_percentage(self):
        sim = M.MoistureSim(random.Random(1), start=0.0)
        self.assertEqual(S.soil_pct(sim.raw()), 0.0)
        sim.pct = 100.0
        self.assertEqual(S.soil_pct(sim.raw()), 100.0)


class SkillTests(unittest.TestCase):
    def fight(self, skill, **stats):
        creature = B.Stats(name="T", hp=stats.get("hp", 30), atk=stats.get("atk", 8), skill=skill)
        return B.start(creature, B.Stats(name="boss", hp=40, atk=6, skill=""))

    def test_thorn_burst_always_hits_but_the_boss_can_hit_back(self):
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "guard")  # guard would block a plain attack
        self.assertEqual(b.boss_hp, 40 - 8)
        self.assertEqual(b.creature_hp, 30)
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "attack")
        self.assertEqual((b.boss_hp, b.creature_hp), (32, 24))

    def test_skill_needs_recharging(self):
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "guard")
        self.assertEqual(b.skill_ready_in, C.SKILL_COOLDOWN_TURNS)
        again = B.resolve_turn(b, B.SKILL, "guard")  # not ready: becomes a plain attack
        self.assertEqual(again.last_move["creature"], "attack")
        self.assertNotIn("skill", again.last_move)
        self.assertEqual(again.skill_ready_in, C.SKILL_COOLDOWN_TURNS - 1)

    def test_skill_is_ready_again_after_the_wait(self):
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "guard")
        for _ in range(C.SKILL_COOLDOWN_TURNS):
            b = B.resolve_turn(b, "guard", "guard")
        self.assertEqual(b.skill_ready_in, 0)

    def test_bark_shield_blocks_everything(self):
        b = self.fight("bark_shield")
        b = B.resolve_turn(b, B.SKILL, "attack")
        self.assertEqual(b.creature_hp, 30)
        self.assertEqual(b.boss_hp, 40 - 4)

    def test_photosynthesis_heals_but_does_not_protect(self):
        b = self.fight("photosynthesis")
        b = B.resolve_turn(b, "special", "attack")   # the plant takes a hit first
        hurt = b.creature_hp
        self.assertLess(hurt, 30)
        b = B.resolve_turn(b, B.SKILL, "attack")      # heal, but the attacking boss still hits
        self.assertEqual(b.last_move["healed"], min(8, 30 - hurt))
        self.assertEqual(b.creature_hp, hurt + b.last_move["healed"] - 6)

    def test_no_skill_means_skill_is_a_plain_attack(self):
        b = B.resolve_turn(self.fight(""), B.SKILL, "special")
        self.assertEqual(b.last_move["creature"], "attack")
        self.assertEqual(b.boss_hp, 40 - 8)

    def test_wilted_plant_hits_weaker_but_never_zero(self):
        weak = B.weakened(B.Stats(atk=8), C.WILTED_ATK_FACTOR)
        self.assertLess(weak.atk, 8)
        self.assertGreaterEqual(B.weakened(B.Stats(atk=1), 0.1).atk, 1)

    def test_every_tier_is_winnable_even_with_no_skill(self):
        for tier in (1, 2, 3):
            wins = 0
            for seed in range(3000):
                rng = random.Random(seed)
                fight = B.start(B.Stats(skill=""), B.boss_for_tier(tier))
                while not B.winner(fight):
                    fight = B.play_turn(fight, rng)
                wins += B.winner(fight) == "creature"
            self.assertGreaterEqual(wins / 3000, 0.40, f"tier {tier}")

    def test_creatures_json_loads_and_ignores_the_comment(self):
        creatures = B.load_creatures("creatures.json")
        self.assertIn("04:A1:B2:C3", creatures)
        self.assertTrue(all(c.skill in C.SKILLS for c in creatures.values()))


class ManualBattleTests(unittest.TestCase):
    def into_battle(self, manual=True, uid="04:A1:B2:C3", seed=3):
        creatures = B.load_creatures("creatures.json")
        e = GameEngine(creatures=creatures, rng=random.Random(seed))
        e.manual = manual
        e.on_pad("A", uid)
        e.on_demo_boss(0.0, "A")
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        return e, C.BOSS_INTRO_SECONDS + 1.0

    def test_battle_waits_for_the_player(self):
        e, t = self.into_battle()
        self.assertEqual(e.game.mode, S.BATTLE)
        for i in range(8):
            e.tick(t + i * 0.5)
        self.assertEqual(e.battle.turn, 0)  # nothing happens until a move or the timeout

    def test_a_move_plays_one_turn(self):
        e, t = self.into_battle()
        e.on_player_move("attack", t)
        self.assertEqual(e.battle.turn, 1)
        self.assertEqual(e.battle.last_move["creature"], "attack")

    def test_moves_are_paced_and_checked(self):
        e, t = self.into_battle()
        e.on_player_move("attack", t)
        e.on_player_move("attack", t + 0.1)       # too soon, the client is still showing the turn
        self.assertEqual(e.battle.turn, 1)
        e.on_player_move("dance", t + 5)          # not a move
        self.assertEqual(e.battle.turn, 1)
        e.on_player_move("guard", t + 5)
        self.assertEqual(e.battle.turn, 2)

    def test_game_picks_when_nobody_does(self):
        e, t = self.into_battle()
        e.tick(t + C.PLAYER_MOVE_TIMEOUT_SECONDS + 1.0)
        self.assertEqual(e.battle.turn, 1)

    def test_moves_outside_a_battle_do_nothing(self):
        e = GameEngine()
        e.manual = True
        self.assertEqual(e.on_player_move("attack", 1.0), [])
        self.assertIsNone(e.battle)

    def test_not_manual_means_the_game_plays_itself(self):
        e, t = self.into_battle(manual=False)
        self.assertEqual(e.on_player_move("attack", t), [])
        e.tick(t + C.BATTLE_TURN_SECONDS + 0.1)
        self.assertGreaterEqual(e.battle.turn, 1)

    def test_pad_picks_the_creature_and_its_skill(self):
        e, _ = self.into_battle(uid="04:D4:E5:F6")
        self.assertEqual(e.battle.creature.name, "Mossling")
        snap = e.snapshot()["battle"]
        self.assertEqual(snap["skill"]["name"], "Photosynthesis")
        self.assertTrue(snap["skill"]["ready"])

    def test_unknown_tag_uses_the_defaults(self):
        e, _ = self.into_battle(uid="not-a-known-tag")
        self.assertEqual(e.battle.creature.name, "Sprout")

    def test_skill_shows_its_recharge_in_the_snapshot(self):
        e, t = self.into_battle()
        e.on_player_move("skill", t)
        snap = e.snapshot()["battle"]
        self.assertFalse(snap["skill"]["ready"])
        self.assertEqual(snap["skill"]["ready_in"], C.SKILL_COOLDOWN_TURNS)

    def test_a_full_manual_fight_ends_and_can_pay_out(self):
        paid = False
        for seed in range(30):
            e, t = self.into_battle(seed=seed)
            for _ in range(60):
                t += C.BATTLE_TURN_SECONDS + 0.1
                cmds = e.on_player_move("skill" if e.battle and e.battle.skill_ready_in == 0 else "attack", t) \
                    if e.game.mode == S.BATTLE else []
                if cmds:
                    paid = True
                    self.assertLessEqual(int(cmds[0].payload), C.PUMP_MAX_MS)
                if e.game.mode != S.BATTLE:
                    break
            self.assertNotEqual(e.game.mode, S.BATTLE)
        self.assertTrue(paid)


class HealthConsequenceTests(unittest.TestCase):
    def test_condition_bands(self):
        e = GameEngine()
        for health, name in [(100, "healthy"), (59, "weary"), (29, "wilting"), (0, "wilted")]:
            e.health = health
            self.assertEqual(e.condition(), name)

    def test_wilted_plant_fights_with_less_attack(self):
        for health, weaker in [(100.0, False), (0.0, True)]:
            e = GameEngine()
            e.health = health
            e.soil_pct = {"A": 10.0, "B": 10.0}   # still dry, so health does not recover
            e.on_demo_boss(0.0, "A")
            e.tick(C.BOSS_INTRO_SECONDS + 0.1)
            self.assertEqual(e.battle.creature.atk < C.DEFAULT_CREATURE_ATK, weaker)

    def test_a_win_perks_the_plant_up(self):
        e = GameEngine(rng=random.Random(1))
        e.health = 10.0
        e.on_demo_boss(0.0, "A")
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        e.battle = replace_boss_hp(e.battle, 1)
        e.tick(C.BOSS_INTRO_SECONDS + 0.1 + C.BATTLE_TURN_SECONDS * 40)
        # a win lifts health by the bonus on top of any fading, so it can never stay at the floor
        self.assertGreater(e.health, 10.0 - 1.0)

    def test_a_wilted_plant_can_still_win_and_recover(self):
        wins = 0
        for seed in range(40):
            e = GameEngine(rng=random.Random(seed))
            e.health = 0.0
            e.on_demo_boss(0.0, "A")
            t = C.BOSS_INTRO_SECONDS + 0.1
            e.tick(t)
            for _ in range(80):
                t += C.BATTLE_TURN_SECONDS + 0.1
                e.tick(t)
                if e.game.mode != S.BATTLE:
                    break
            wins += e.game.mode == S.REWARD
        self.assertGreater(wins, 0)


def replace_boss_hp(battle, hp):
    from dataclasses import replace
    return replace(battle, boss_hp=hp)


class StaleTimerTests(unittest.TestCase):
    def test_silence_counts_as_offline(self):
        e = GameEngine()
        e.on_soil_raw("A", WET_RAW, 0.0)
        e.tick(C.ESP32_STALE_SECONDS - 1)
        self.assertFalse(e.game.stale)
        e.tick(C.ESP32_STALE_SECONDS + 1)
        self.assertTrue(e.game.stale)
        self.assertTrue(e.snapshot()["meters"]["stale"])

    def test_a_boss_is_dropped_when_the_readings_stop(self):
        e = GameEngine()
        e.on_soil_raw("A", WET_RAW, 0.0)
        e.on_demo_boss(1.0, "A")
        e.tick(5.0)
        self.assertEqual(e.game.mode, S.BATTLE)
        e.tick(C.ESP32_STALE_SECONDS + 5)
        self.assertEqual(e.game.mode, S.WALKING)
        self.assertIsNone(e.battle)

    def test_no_pump_while_the_link_is_silent(self):
        paid = []
        for seed in range(25):
            e = GameEngine(rng=random.Random(seed))
            e.on_soil_raw("A", DRY_RAW, 0.0)
            e.tick(C.ESP32_STALE_SECONDS + 2)            # the readings stopped
            self.assertTrue(e.game.stale)
            e.on_demo_boss(C.ESP32_STALE_SECONDS + 3, "A")
            t = C.ESP32_STALE_SECONDS + 3
            for _ in range(240):
                t += 0.5
                paid += e.tick(t)
            self.assertNotEqual(e.game.mode, S.BATTLE)   # the fight did finish
        self.assertEqual(paid, [])

    def test_readings_bring_it_back(self):
        e = GameEngine()
        e.on_soil_raw("A", WET_RAW, 0.0)
        e.tick(C.ESP32_STALE_SECONDS + 5)
        self.assertTrue(e.game.stale)
        e.on_soil_raw("A", WET_RAW, C.ESP32_STALE_SECONDS + 6)
        self.assertFalse(e.game.stale)

    def test_never_stale_before_the_first_reading(self):
        e = GameEngine()
        e.tick(1000.0)
        self.assertFalse(e.game.stale)


class BothPlantsDryTests(unittest.TestCase):
    def waiting_game(self, a_pct, b_pct):
        """Both plants are dry and waiting out a cooldown that a boss of any tier cannot skip."""
        g = S.Game(mode=S.COOLDOWN, cooldown_until={"A": 100.0, "B": 100.0}, last_tier=3, mode_until=100.0)
        for _ in range(C.SOIL_DRY_READINGS_N + 2):
            g = S.on_soil(g, "A", a_pct, 10.0)
            g = S.on_soil(g, "B", b_pct, 10.0)
        self.assertEqual(g.mode, S.COOLDOWN)  # still waiting
        return g

    def test_the_thirstier_plant_goes_first_when_the_cooldown_ends(self):
        for a_pct, b_pct, expected in [(40.0, 10.0, "B"), (10.0, 40.0, "A")]:
            g = self.waiting_game(a_pct, b_pct)
            g = S.on_tick(g, 101.0)
            g = S.on_soil(g, "A", a_pct, 101.0)   # whichever plant reports first, the drier one wins
            self.assertEqual((g.mode, g.boss_plant), (S.BOSS, expected), (a_pct, b_pct))
            g2 = S.on_soil(S.on_tick(self.waiting_game(a_pct, b_pct), 101.0), "B", b_pct, 101.0)
            self.assertEqual(g2.boss_plant, expected)

    def test_the_boss_tier_follows_the_plant_it_picked(self):
        g = S.on_soil(S.on_tick(self.waiting_game(40.0, 10.0), 101.0), "A", 40.0, 101.0)
        self.assertEqual(g.tier, 2)

    def test_one_dry_plant_still_works(self):
        g = S.Game()
        for _ in range(C.SOIL_DRY_READINGS_N):
            g = S.on_soil(g, "B", 30.0, 0)
            g = S.on_soil(g, "A", 90.0, 0)
        self.assertEqual((g.mode, g.boss_plant), (S.BOSS, "B"))

    def test_the_first_plant_to_get_there_gets_the_boss(self):
        g = S.Game()
        for _ in range(C.SOIL_DRY_READINGS_N):
            g = S.on_soil(g, "A", 40.0, 0)
        for _ in range(C.SOIL_DRY_READINGS_N - 1):
            g = S.on_soil(g, "B", 5.0, 0)
        self.assertEqual((g.mode, g.boss_plant), (S.BOSS, "A"))


if __name__ == "__main__":
    unittest.main()
