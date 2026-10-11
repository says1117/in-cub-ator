"""Run: python -m unittest test_server -v  (from the server folder, no hardware needed)"""
import random
import unittest
from dataclasses import replace

import battle as B
import moisture_sim as M
import config as C
import rewards as R
import state_machine as S
from engine import GameEngine

C.PLANTS_NEED_PADS = False   # most tests do not touch the pads: both plants count as on the cube (PresenceTests turns pads on)
DRY_RAW = C.SOIL_RAW_DRY
WET_RAW = C.SOIL_RAW_WET


def feed_dry(g, plant="A", n=C.SOIL_DRY_READINGS_N, now=0.0):
    for _ in range(n):
        g = S.on_soil(g, plant, 5.0, now)
    return g


def talking(e):
    """The same engine with an ESP32 that never goes quiet, for tests that do not send readings."""
    e.last_seen = float("inf")
    return e


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
        b = B.start(B.Stats(hp=10, atk=5), B.Stats(hp=30, atk=3))
        b = B.resolve_turn(b, "attack", "special")
        self.assertEqual(b.boss_hp, 25)
        b = B.resolve_turn(b, "attack", "attack")   # a tie: the plant is grazed for half, rounded down
        self.assertEqual((b.boss_hp, b.creature_hp), (25, 9))
        self.assertEqual(b.last_move["hit"], "tie")
        b = B.resolve_turn(b, "attack", "guard")
        self.assertEqual(b.creature_hp, 6)

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
                e = talking(GameEngine(rng=random.Random(seed)))
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


class BossKindTests(unittest.TestCase):
    def call_boss(self, seed, plant="A"):
        e = GameEngine(rng=random.Random(seed))
        e.on_demo_boss(0.0, plant)
        return e

    def test_every_kind_is_equally_likely(self):
        counts = {k: 0 for k in C.BOSS_KINDS}
        for seed in range(2000):
            counts[self.call_boss(seed).snapshot()["boss"]["kind"]] += 1
        for kind, n in counts.items():
            self.assertAlmostEqual(n / 2000, 1 / len(C.BOSS_KINDS), delta=0.04, msg=kind)

    def test_the_kind_does_not_depend_on_how_dry_it_is(self):
        for pct in (40.0, 10.0, 0.0):
            seen = set()
            for seed in range(60):
                e = GameEngine(rng=random.Random(seed))
                e.soil_pct = {"A": pct, "B": 100.0}
                e.on_demo_boss(0.0, "A")
                seen.add(e.snapshot()["boss"]["kind"])
            self.assertEqual(seen, set(C.BOSS_KINDS), f"soil {pct}%")

    def test_the_kind_and_name_stay_the_same_through_a_fight(self):
        e = self.call_boss(5)
        kind = e.snapshot()["boss"]["kind"]
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        snap = e.snapshot()
        self.assertEqual((snap["boss"]["kind"], snap["boss"]["name"]), (kind, C.BOSS_KINDS[kind]))
        self.assertEqual(e.battle.boss.name, C.BOSS_KINDS[kind])

    def test_the_numbers_still_follow_the_dryness(self):
        for tier, (_, hp, atk) in C.BOSS_TIERS.items():
            e = GameEngine(rng=random.Random(tier))
            e.soil_pct = {"A": {1: 40.0, 2: 10.0, 3: 0.0}[tier], "B": 100.0}
            e.on_demo_boss(0.0, "A")
            e.tick(C.BOSS_INTRO_SECONDS + 0.1)
            self.assertEqual((e.battle.boss.hp, e.battle.boss.atk), (hp, atk))

    def test_a_new_boss_is_picked_each_time(self):
        e = GameEngine(rng=random.Random(1))
        kinds = set()
        t = 0.0
        for _ in range(30):
            e.on_demo_boss(t, "A")
            kinds.add(e.snapshot()["boss"]["kind"])
            e.on_esp_status("offline", t)      # a lost link sends the boss away
            e.on_soil_raw("A", WET_RAW, t)
            t += C.BOSS_BREATHER_SECONDS + C.COOLDOWN_SECONDS + 1
            e.tick(t)
        self.assertEqual(kinds, set(C.BOSS_KINDS))


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
        later = 10.0 + C.BOSS_BREATHER_SECONDS + 1.0       # past the breather, inside the cooldown
        g = feed_dry_pct(g, 40.0, now=later)               # same tier: still blocked
        self.assertEqual(g.mode, S.COOLDOWN)
        g = feed_dry_pct(g, 10.0, now=later + 1.0)         # drier: a harder boss comes
        self.assertEqual((g.mode, g.tier), (S.BOSS, 2))

    def test_no_plant_calls_a_boss_right_after_a_fight(self):
        g = S.on_tick(feed_dry_pct(S.Game(), 40.0), C.BOSS_INTRO_SECONDS)   # plant A's boss
        g, _ = S.on_battle_done(g, True, 10.0)
        g = S.on_tick(g, 10.0 + C.REWARD_DISPLAY_SECONDS)
        for i in range(C.SOIL_DRY_READINGS_N + 2):          # plant B is bone dry, but it has to wait
            g = S.on_soil(g, "B", 0.0, 11.0 + i * 0.1)
        self.assertNotEqual(g.mode, S.BOSS)
        after = 10.0 + C.BOSS_BREATHER_SECONDS + 0.1
        g = S.on_soil(S.on_tick(g, after), "B", 0.0, after)
        self.assertEqual((g.mode, g.boss_plant), (S.BOSS, "B"))

    def test_the_demo_button_ignores_the_breather(self):
        g = S.on_tick(feed_dry_pct(S.Game(), 40.0), C.BOSS_INTRO_SECONDS)
        g, _ = S.on_battle_done(g, False, 10.0)
        g = S.on_demo(g, "B", 11.0)
        self.assertEqual((g.mode, g.boss_plant), (S.BOSS, "B"))

    def test_bosses_get_stronger(self):
        hp = [B.boss_for_tier(t).hp for t in (1, 2, 3)]
        atk = [B.boss_for_tier(t).atk for t in (1, 2, 3)]
        self.assertEqual(hp, sorted(hp))
        self.assertEqual(atk, sorted(atk))
        self.assertLess(hp[0], hp[2])


def team_fight(tier, first="A", skills=True):
    """A fight the way the game starts one: one plant in, the other on the bench."""
    def stats(plant):
        s = B.plant_fighter(plant)
        return s if skills else replace(s, skill="")
    other = "B" if first == "A" else "A"
    return B.start(stats(first), B.boss_for_tier(tier), plant=first, bench=[(other, stats(other))],
                   tier=tier)


def charged(b):
    """The same fight with the skill ready to use."""
    return replace(b, charge=C.SKILL_CHARGE_NEED)


def win_rate(tier, pick, games=3000, **kw):
    """Share of fights the plants win when `pick(fight, rng)` chooses every move."""
    wins = 0
    for seed in range(games):
        rng = random.Random(seed)
        fight = B.plan(team_fight(tier, "AB"[seed % 2], **kw), rng)
        while not B.winner(fight):
            fight = B.play_turn(fight, rng, pick(fight, rng))
        wins += B.winner(fight) == "creature"
    return wins / games


class TeamTests(unittest.TestCase):
    """The two plants fight as a team: the dry one first, the other steps in if it faints."""

    def into_battle(self, plant="A", seed=1):
        e = talking(GameEngine(rng=random.Random(seed)))
        e.manual = True
        e.on_demo_boss(0.0, plant)
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        return e, C.BOSS_INTRO_SECONDS + 1.0

    def test_the_plant_that_called_the_boss_fights_first(self):
        for first, other in (("A", "B"), ("B", "A")):
            e, _ = self.into_battle(first)
            self.assertEqual(e.battle.plant, first)
            self.assertEqual(e.battle.creature.name, C.PLANT_FIGHTERS[first]["name"])
            self.assertEqual([p for p, _ in e.battle.bench], [other])

    def test_the_other_plant_steps_in_when_the_first_faints(self):
        b = replace(team_fight(1, "A"), creature_hp=1, charge=0)
        b = B.resolve_turn(b, "special", "attack")      # attack beats special: the plant is hit
        self.assertEqual(b.plant, "B")
        self.assertEqual(b.creature.name, C.PLANT_FIGHTERS["B"]["name"])
        self.assertEqual(b.creature_hp, C.PLANT_FIGHTERS["B"]["hp"])   # full strength
        self.assertTrue(B.skill_ready(b))                              # its own skill, charged
        self.assertEqual(b.last_move["swap"], {"out": "A", "in": "B", "name": C.PLANT_FIGHTERS["B"]["name"]})
        self.assertEqual(b.bench, ())
        self.assertEqual([p for p, _ in b.fallen], ["A"])
        self.assertIsNone(B.winner(b))                                 # the fight goes on

    def test_the_fight_is_lost_only_when_both_plants_are_down(self):
        b = replace(team_fight(1, "A"), creature_hp=1)
        b = B.resolve_turn(b, "special", "attack")
        self.assertIsNone(B.winner(b))
        b = replace(b, creature_hp=1)
        b = B.resolve_turn(b, "special", "attack")
        self.assertEqual(b.creature_hp, 0)
        self.assertEqual(B.winner(b), "boss")
        self.assertNotIn("swap", b.last_move)

    def test_nobody_steps_in_once_the_boss_is_beaten(self):
        b = charged(replace(team_fight(1, "A"), creature_hp=1, boss_hp=1))
        b = B.resolve_turn(b, B.SKILL, "attack")   # the skill lands, and the boss hits back
        self.assertEqual(B.winner(b), "creature")
        self.assertEqual(b.plant, "A")
        self.assertNotIn("swap", b.last_move)

    def test_a_fight_with_no_bench_works_as_before(self):
        b = replace(B.start(B.Stats(), B.boss_for_tier(1)), creature_hp=1)
        b = B.resolve_turn(b, "special", "attack")
        self.assertEqual(B.winner(b), "boss")

    def test_snapshot_lists_the_team(self):
        e, t = self.into_battle("A")
        snap = e.snapshot()
        self.assertEqual(snap["battle"]["plant"], "A")
        self.assertEqual(snap["battle"]["team"]["A"]["state"], "fighting")
        self.assertEqual(snap["battle"]["team"]["B"]["state"], "ready")
        self.assertEqual(set(snap["fighters"]), set(C.PLANTS))
        e.battle = replace(e.battle, creature_hp=1)
        while e.battle.plant == "A":
            t += C.BATTLE_TURN_SECONDS + 0.1
            e.battle = replace(e.battle, creature_hp=1, boss_hp=e.battle.boss.hp)
            e.on_player_move("special", t)
        team = e.snapshot()["battle"]["team"]
        self.assertEqual(team["A"], {"name": C.PLANT_FIGHTERS["A"]["name"], "hp": 0,
                                     "max_hp": C.PLANT_FIGHTERS["A"]["hp"], "state": "down"})
        self.assertEqual(team["B"]["state"], "fighting")
        self.assertEqual(e.snapshot()["battle"]["creature"], C.PLANT_FIGHTERS["B"]["name"])

    def test_the_dry_plant_is_watered_even_when_the_other_one_wins_the_fight(self):
        e, t = self.into_battle("A")
        e.battle = replace(e.battle, creature_hp=1)
        while e.battle.plant == "A":
            t += C.BATTLE_TURN_SECONDS + 0.1
            e.battle = replace(e.battle, creature_hp=1, boss_hp=e.battle.boss.hp)
            e.on_player_move("special", t)
        cmds = []
        while e.game.mode == S.BATTLE:
            t += C.BATTLE_TURN_SECONDS + 0.1
            e.battle = replace(e.battle, boss_hp=1, creature_hp=e.battle.creature.hp)
            cmds = e.on_player_move("skill", t) or cmds
        self.assertEqual(e.game.mode, S.REWARD)
        self.assertEqual([c.topic for c in cmds], [C.TOPIC_CMD_PUMP.format(plant="A")])

    def test_a_known_figure_on_a_pad_replaces_that_plant(self):
        e = GameEngine(creatures=B.load_creatures("creatures.json"), rng=random.Random(1))
        e.on_pad("B", "04:D4:E5:F6")
        e.on_demo_boss(0.0, "A")
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        self.assertEqual(e.battle.creature.name, C.PLANT_FIGHTERS["A"]["name"])
        self.assertEqual(e.battle.bench[0][1].name, "Mossling")


class PlantSkillTests(unittest.TestCase):
    """Each plant has a skill of its own."""

    def test_ember_inferno_bloom_hits_harder_than_a_plain_attack(self):
        ember = B.plant_fighter("A")
        b = B.resolve_turn(charged(B.start(ember, B.boss_for_tier(1))), "skill", "guard")
        dealt = B.boss_for_tier(1).hp - b.boss_hp
        self.assertEqual(b.last_move["skill"], "Inferno Bloom")
        self.assertGreater(dealt, ember.atk)
        self.assertEqual(b.creature_hp, ember.hp)          # a guarding boss does not hit back

    def test_zest_sunburst_heals_and_hits(self):
        zest = B.plant_fighter("B")
        hurt = charged(replace(B.start(zest, B.boss_for_tier(1)), creature_hp=10))
        b = B.resolve_turn(hurt, "skill", "special")
        self.assertEqual(b.last_move["skill"], "Sunburst")
        self.assertEqual(b.creature_hp, 10 + C.SKILLS["sunburst"]["heal"])
        self.assertLess(b.boss_hp, B.boss_for_tier(1).hp)
        self.assertEqual(b.last_move["hit"], "creature")

    def test_an_attacking_boss_still_hits_through_either_skill(self):
        for plant in C.PLANTS:
            stats = B.plant_fighter(plant)
            b = B.resolve_turn(charged(replace(B.start(stats, B.boss_for_tier(1)), creature_hp=20)), "skill", "attack")
            self.assertEqual(b.last_move["hit"], "both")

    def test_every_plant_skill_exists(self):
        for plant in C.PLANTS:
            self.assertIn(C.PLANT_FIGHTERS[plant]["skill"], C.SKILLS)


def believe(fight, rng):
    return B.auto_move(fight, rng)


def mash(fight, rng):
    return rng.choice(B.PLAYER_MOVES)


class BalanceTests(unittest.TestCase):
    """A win waters the plant, so answering the tells must win, and ignoring them must not."""

    def test_answering_every_tell_wins_on_every_tier(self):
        # This is also what the game plays when nobody is at the screen.
        for tier, floor in ((1, 0.95), (2, 0.90), (3, 0.75)):
            self.assertGreaterEqual(win_rate(tier, believe), floor, f"tier {tier}")

    def test_random_buttons_do_worse_than_reading(self):
        for tier in (1, 2, 3):
            self.assertLess(win_rate(tier, mash, games=1500), win_rate(tier, believe, games=1500) - 0.2,
                            f"tier {tier}")

    def test_one_key_loses(self):
        for move in B.PLAYER_MOVES:
            for tier in (1, 2, 3):
                self.assertLess(win_rate(tier, lambda f, r: move, games=1000), 0.5, f"{move} on tier {tier}")

    def test_always_copying_the_boss_loses(self):
        for tier in (1, 2, 3):
            self.assertLess(win_rate(tier, lambda f, r: f.intent["move"], games=1000), 0.5, f"tier {tier}")


class TellTests(unittest.TestCase):
    """The boss shows the move it is winding up before the player picks."""

    def planned(self, tier, seed, **changes):
        return B.plan(replace(team_fight(tier), **changes), random.Random(seed))

    def test_a_sure_tell_is_always_the_real_move(self):
        for seed in range(300):
            b = self.planned(1, seed)
            self.assertEqual(b.intent["grade"], "sure")
            self.assertEqual(b.boss_next, b.intent["move"])
            self.assertIsNone(b.intent["bluff"])

    def test_a_bluff_is_always_the_move_that_was_shown_as_the_bluff(self):
        bluffs = 0
        for seed in range(600):
            b = self.planned(3, seed)
            self.assertIn(b.boss_next, (b.intent["move"], b.intent["bluff"]))
            self.assertEqual(b.intent["bluff"], B.BEATS[b.intent["move"]])  # it beats the natural counter
            bluffs += b.boss_next != b.intent["move"]
        self.assertGreater(bluffs, 100)

    def test_a_grade_is_honest_about_its_chance(self):
        real = total = 0
        for seed in range(4000):
            b = self.planned(2, seed, turn=0)
            if b.intent["grade"] == "likely":
                total += 1
                real += b.boss_next == b.intent["move"]
        self.assertAlmostEqual(real / total, C.TELL_CHANCE["likely"], delta=0.03)

    def test_tells_get_shakier_when_the_boss_is_enraged(self):
        calm = sum(self.planned(1, s).intent["chance"] for s in range(400))
        angry = sum(self.planned(1, s, enraged=True).intent["chance"] for s in range(400))
        self.assertLess(angry, calm)

    def test_the_boss_enrages_at_half_health_and_hits_harder(self):
        b = replace(team_fight(1), boss_hp=20)
        self.assertFalse(b.enraged)
        calm_hit = B.plain_hit(b)
        b = B.resolve_turn(b, "attack", "special")
        self.assertTrue(b.enraged)
        self.assertTrue(b.last_move["enraged"])
        self.assertEqual(B.plain_hit(b), calm_hit + C.ENRAGE_ATK_BONUS[1])

    def test_a_heavy_wind_up_comes_every_third_turn_and_hits_double(self):
        b = self.planned(2, 1, turn=2)
        self.assertTrue(b.intent["heavy"])
        self.assertEqual(b.intent["grade"], "sure")
        self.assertFalse(self.planned(2, 1, turn=0).intent["heavy"])
        self.assertFalse(self.planned(1, 1, turn=2).intent["heavy"])   # tier 1 never does
        hit = B.resolve_turn(b, B.BEATS[b.boss_next], b.boss_next)     # the plant picks the losing move
        self.assertEqual(hit.last_move["took"], B.boss_for_tier(2).atk * 2)
        self.assertTrue(hit.last_move["heavy"])

    def test_a_landed_bluff_hits_harder_and_is_reported(self):
        b = replace(self.planned(3, 1, turn=0), boss_next="")
        shown = b.intent["move"]
        real = b.intent["bluff"] or B.BEATS[shown]
        hit = B.resolve_turn(b, B.BEATEN_BY[shown], real)   # the plant countered the shown move
        self.assertTrue(hit.last_move["bluffed"])
        self.assertEqual(hit.last_move["shown"], shown)
        self.assertEqual(hit.last_move["took"], int(B.boss_for_tier(3).atk * C.BLUFF_FACTOR + 0.5))

    def test_no_single_hit_goes_over_the_cap(self):
        for tier in (1, 2, 3):
            for seed in range(200):
                b = self.planned(tier, seed, enraged=True, turn=2)
                for move in B.MOVES:
                    self.assertLessEqual(B.boss_hit(b, move), C.BOSS_HIT_CAP)

    def test_the_boss_answers_a_move_it_has_seen_twice(self):
        answered = sum(self.planned(3, s, seen=("guard", "guard")).intent["move"] == "special"
                       for s in range(400))
        self.assertGreater(answered / 400, 0.8)

    def test_copying_the_shown_move_is_safe_against_a_bluff(self):
        b = replace(self.planned(3, 1, turn=0))
        shown, real = b.intent["move"], B.BEATS[b.intent["move"]]
        hit = B.resolve_turn(b, shown, real)
        self.assertEqual(hit.last_move["hit"], "creature")   # the copy beats the bluff move

    def test_the_real_move_never_reaches_the_screen(self):
        e = GameEngine(rng=random.Random(2))
        e.manual = True
        e.on_demo_boss(0.0, "A")
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        snap = e.snapshot()["battle"]
        self.assertEqual(set(snap["intent"]), {"move", "grade", "chance", "bluff", "heavy"})
        self.assertNotIn("boss_next", snap)
        self.assertTrue(snap["hints"])                        # tier 1 teaches the triangle
        self.assertEqual(snap["enrage_hp"], B.boss_for_tier(1).hp // 2)

    def test_a_weary_cube_starts_with_an_empty_skill(self):
        for health, charge in ((100.0, C.SKILL_CHARGE_START), (40.0, C.SKILL_CHARGE_START_WEARY)):
            e = GameEngine(rng=random.Random(2))
            e.health = health
            e.soil_pct = {"A": 10.0, "B": 10.0}
            e.on_demo_boss(0.0, "A")
            e.tick(C.BOSS_INTRO_SECONDS + 0.1)
            self.assertEqual(e.battle.charge, charge)


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

    def test_health_holds_during_a_fight(self):
        e = GameEngine(rng=random.Random(1))
        e.manual = True
        e.soil_pct = {"A": 10.0, "B": 10.0}
        e.on_demo_boss(0.0, "A")
        before = e.health
        for i in range(1, 9):
            e.tick(i * 1.0)
        self.assertIn(e.game.mode, (S.BOSS, S.BATTLE))
        self.assertEqual(e.health, before)

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
        self.assertEqual(snap["boss"]["name"], C.BOSS_KINDS[snap["boss"]["kind"]])


class SimTests(unittest.TestCase):
    def test_soil_only_dries_and_passes_through_every_tier(self):
        sim = M.MoistureSim(random.Random(7), start=90.0)
        seen, last = set(), 90.0
        for _ in range(2000):
            pct = sim.step(1.0)
            self.assertTrue(0.0 <= pct <= last)      # never gets wetter by itself
            last = pct
            seen.add(S.tier_for(pct))
        self.assertEqual(seen, {0, 1, 2, 3})

    def test_drying_is_slow(self):
        sim = M.MoistureSim(random.Random(3), start=100.0)
        for _ in range(60):
            sim.step(1.0)
        self.assertGreater(sim.pct, C.SOIL_WET_THRESHOLD_PCT)   # a minute is not enough to call a boss

    def test_watering_raises_it(self):
        sim = M.MoistureSim(random.Random(1), start=10.0)
        sim.watered(3000)
        self.assertGreaterEqual(sim.pct, C.SIM_WATERED_AT_LEAST_PCT)

    def test_a_watered_plant_stays_wet_for_a_good_while(self):
        for seed in range(20):
            sim = M.MoistureSim(random.Random(seed), start=0.0)
            sim.watered(min(C.PUMP_MS_BY_TIER.values()))
            wet = sim.pct
            for _ in range(int(C.SIM_SOAK_SECONDS)):
                sim.step(1.0)
            self.assertEqual(sim.pct, wet)                       # soaked: holds its moisture
            seconds = 0
            while sim.pct >= C.SOIL_DRY_THRESHOLD_PCT:
                sim.step(1.0)
                seconds += 1
            self.assertGreater(seconds, 60)                      # then at least a minute before it is dry

    def test_raw_matches_the_percentage(self):
        sim = M.MoistureSim(random.Random(1), start=0.0)
        self.assertEqual(S.soil_pct(sim.raw()), 0.0)
        sim.pct = 100.0
        self.assertEqual(S.soil_pct(sim.raw()), 100.0)


class SkillTests(unittest.TestCase):
    def fight(self, skill, **stats):
        creature = B.Stats(name="T", hp=stats.get("hp", 30), atk=stats.get("atk", 8), skill=skill)
        return charged(B.start(creature, B.Stats(name="boss", hp=40, atk=6, skill="")))

    def test_thorn_burst_always_hits_but_the_boss_can_hit_back(self):
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "guard")  # guard would block a plain attack
        self.assertEqual(b.boss_hp, 40 - 8)
        self.assertEqual(b.creature_hp, 30)
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "attack")
        self.assertEqual((b.boss_hp, b.creature_hp), (32, 24))

    def test_a_used_skill_is_empty(self):
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "guard")
        self.assertEqual(b.charge, 0)
        again = B.resolve_turn(b, B.SKILL, "guard")  # not charged: becomes a plain attack
        self.assertEqual(again.last_move["creature"], "attack")
        self.assertNotIn("skill", again.last_move)

    def test_won_turns_charge_the_skill_again(self):
        b = B.resolve_turn(self.fight("thorn_burst"), B.SKILL, "guard")
        b = B.resolve_turn(b, "guard", "guard")      # a tie charges nothing
        b = B.resolve_turn(b, "special", "attack")   # nor does a lost turn
        self.assertEqual(b.charge, 0)
        for _ in range(C.SKILL_CHARGE_NEED):
            self.assertFalse(B.skill_ready(b))
            b = B.resolve_turn(b, "attack", "special")
        self.assertTrue(B.skill_ready(b))

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
        self.assertEqual(b.last_move["took"], 6)

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
            self.assertGreaterEqual(win_rate(tier, believe, skills=False), 0.40, f"tier {tier}")

    def test_creatures_json_loads_and_ignores_the_comment(self):
        creatures = B.load_creatures("creatures.json")
        self.assertIn("04:A1:B2:C3", creatures)
        self.assertTrue(all(c.skill in C.SKILLS for c in creatures.values()))


class ManualBattleTests(unittest.TestCase):
    def into_battle(self, manual=True, uid="04:A1:B2:C3", seed=3):
        creatures = B.load_creatures("creatures.json")
        e = talking(GameEngine(creatures=creatures, rng=random.Random(seed)))
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
        self.assertEqual(snap["skill"]["charge"], C.SKILL_CHARGE_START)
        self.assertEqual(snap["skill"]["need"], C.SKILL_CHARGE_NEED)
        self.assertFalse(snap["skill"]["ready"])

    def test_unknown_tag_uses_the_defaults(self):
        e, _ = self.into_battle(uid="not-a-known-tag")
        self.assertEqual(e.battle.creature.name, C.PLANT_FIGHTERS["A"]["name"])

    def test_skill_shows_its_charge_in_the_snapshot(self):
        e, t = self.into_battle()
        e.battle = charged(e.battle)
        self.assertTrue(e.snapshot()["battle"]["skill"]["ready"])
        e.on_player_move("skill", t)
        snap = e.snapshot()["battle"]
        self.assertFalse(snap["skill"]["ready"])
        self.assertEqual(snap["skill"]["charge"], 0)

    def test_a_full_manual_fight_ends_and_can_pay_out(self):
        paid = False
        for seed in range(30):
            e, t = self.into_battle(seed=seed)
            for _ in range(60):
                t += C.BATTLE_TURN_SECONDS + 0.1
                cmds = e.on_player_move(B.auto_move(e.battle, e.rng), t) if e.game.mode == S.BATTLE else []
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
    def won_demo(self, e):
        e.manual = True
        e.on_demo_boss(0.0, "A")
        t = C.BOSS_INTRO_SECONDS + 0.1
        e.tick(t)
        e.battle = charged(replace(e.battle, boss_hp=1))
        return e.on_player_move("skill", t + 1.0)

    def test_no_pump_before_the_esp32_was_ever_heard_from(self):
        e = GameEngine(rng=random.Random(1))
        self.assertEqual(self.won_demo(e), [])
        self.assertEqual(e.game.mode, S.REWARD)          # the fight is still won on screen
        self.assertIsNone(e.snapshot()["reward"])        # and no watering is claimed
        e = GameEngine(rng=random.Random(1))
        e.on_soil_raw("A", WET_RAW, 0.0)
        self.assertEqual(len(self.won_demo(e)), 1)

    def test_status_messages_cannot_hide_missing_readings(self):
        e = GameEngine()
        e.on_soil_raw("A", WET_RAW, 0.0)
        for t in range(5, int(C.ESP32_STALE_SECONDS) + 10, 5):
            e.on_esp_status("online", float(t))
            e.tick(float(t))
        self.assertTrue(e.game.stale)

    def test_an_old_reward_is_not_shown_for_a_new_fight(self):
        e = GameEngine(rng=random.Random(1))
        e.last_reward = {"type": "water", "plant": "A", "size": 2000, "tier": 1}
        e.on_demo_boss(0.0, "A")
        e.tick(C.BOSS_INTRO_SECONDS + 0.1)
        self.assertIsNone(e.snapshot()["reward"])

    def test_a_lost_fight_stays_on_screen_for_its_last_blow(self):
        e = talking(GameEngine(rng=random.Random(1)))
        e.manual = True
        e.on_demo_boss(0.0, "A")
        t = C.BOSS_INTRO_SECONDS + 0.1
        e.tick(t)
        e.battle = replace(e.battle, creature_hp=1, bench=(), intent=dict(e.battle.intent, move="attack"),
                           boss_next="attack")
        self.assertEqual(e.on_player_move("special", t + 1.0), [])
        e.tick(t + 1.2)
        snap = e.snapshot()
        self.assertEqual(snap["mode"], S.COOLDOWN)
        self.assertEqual(snap["battle"]["creature_hp"], 0)
        self.assertEqual(snap["boss"]["plant"], "A")
        self.assertFalse(snap["battle"]["awaiting_move"])
        e.tick(t + 1.2 + C.LOSS_DISPLAY_SECONDS)
        self.assertIsNone(e.snapshot()["battle"])
        self.assertIsNone(e.snapshot()["boss"])

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
        e.tick(1.0 + C.BOSS_INTRO_SECONDS)
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


class PresenceTests(unittest.TestCase):
    """A plant only counts while its pad reads a tag: no tag, no meter, no boss, no water."""

    def engine(self, *on):
        e = GameEngine(rng=random.Random(5), need_pads=True)
        for p in on:
            e.on_pad(p, "TAG-" + p)
        return e

    def dry(self, e, plant, t=0.0):
        cmds = []
        for _ in range(C.SOIL_DRY_READINGS_N):
            cmds += e.on_soil_raw(plant, DRY_RAW, t)
        return cmds

    def test_no_plant_no_boss(self):
        e = self.engine()
        self.dry(e, "A")
        self.dry(e, "B")
        self.assertEqual(e.game.mode, S.WALKING)

    def test_no_plant_no_demo_boss(self):
        e = self.engine()
        e.on_soil_raw("A", WET_RAW, 0.0)
        self.assertEqual(e.on_demo_boss(1.0), [])
        self.assertEqual(e.on_debug_boss("A", 1.0), [])
        self.assertEqual(e.game.mode, S.WALKING)

    def test_only_the_plant_on_the_cube_calls_a_boss(self):
        e = self.engine("B")
        self.dry(e, "A")
        self.assertEqual(e.game.mode, S.WALKING)
        self.dry(e, "B")
        self.assertEqual((e.game.mode, e.game.boss_plant), (S.BOSS, "B"))

    def test_a_lone_plant_fights_alone_and_is_watered(self):
        e = self.engine("A")
        self.dry(e, "A")
        self.assertEqual(e.game.mode, S.BOSS)
        t, cmds = 0.0, []
        while t < 3000 and e.game.mode != S.COOLDOWN:
            t += 0.5
            cmds += e.tick(t)
            if e.battle:
                self.assertEqual(e.battle.bench, ())
        self.assertTrue(all(c.topic == C.TOPIC_CMD_PUMP.format(plant="A") for c in cmds))

    def test_snapshot_hides_the_meter_of_a_missing_plant(self):
        e = self.engine("A")
        e.on_soil_raw("A", WET_RAW, 0.0)
        e.on_soil_raw("B", DRY_RAW, 0.0)
        snap = e.snapshot()
        self.assertEqual(snap["present"], {"A": True, "B": False})
        self.assertIsNotNone(snap["meters"]["water"]["A"])
        self.assertIsNone(snap["meters"]["water"]["B"])
        e.on_pad("A", "")
        snap = e.snapshot()
        self.assertEqual(snap["present"], {"A": False, "B": False})
        self.assertEqual(snap["meters"]["water"], {"A": None, "B": None})

    def test_lifting_the_plant_that_called_the_boss_sends_it_away(self):
        e = self.engine("A", "B")
        self.dry(e, "A")
        self.assertEqual(e.game.mode, S.BOSS)
        e.on_pad("A", "")
        self.assertEqual(e.game.mode, S.WALKING)
        self.assertIsNone(e.game.boss_plant)

    def test_lifting_it_mid_fight_ends_the_fight_without_water(self):
        e = self.engine("A", "B")
        self.dry(e, "A")
        t = 0.0
        while e.game.mode != S.BATTLE:
            t += 0.5
            e.tick(t)
        e.on_pad("A", "")
        self.assertEqual(e.game.mode, S.WALKING)
        self.assertIsNone(e.battle)
        self.assertEqual(e.tick(t + 1.0), [])

    def test_lifting_the_bench_plant_takes_it_out_of_the_fight(self):
        e = self.engine("A", "B")
        self.dry(e, "A")
        t = 0.0
        while e.game.mode != S.BATTLE:
            t += 0.5
            e.tick(t)
        self.assertEqual([p for p, _ in e.battle.bench], ["B"])
        e.on_pad("B", "")
        self.assertEqual(e.battle.bench, ())
        self.assertEqual(e.game.mode, S.BATTLE)

    def test_a_plant_that_is_set_down_starts_with_a_clean_dry_count(self):
        e = self.engine()
        self.dry(e, "A")       # dry the whole time, but not on the cube
        e.on_pad("A", "TAG-A")
        e.on_soil_raw("A", DRY_RAW, 1.0)
        self.assertEqual(e.game.mode, S.WALKING)   # one reading is not enough

    def test_health_holds_with_no_plant(self):
        e = self.engine()
        e.on_soil_raw("A", DRY_RAW, 0.0)
        for i in range(1, 400):
            e.tick(float(i))
        self.assertEqual(e.health, 100.0)

    def test_pads_not_in_use_means_both_plants_count(self):
        e = GameEngine(rng=random.Random(5), need_pads=False)
        self.dry(e, "A")
        self.assertEqual(e.game.mode, S.BOSS)

    def test_sim_pad_button_toggles_a_plant(self):
        e = self.engine("A", "B")
        e.on_sim_pad("A")            # not --sim: ignored
        self.assertTrue(e.present("A"))
        e.sim = True
        e.on_sim_pad("A")
        self.assertFalse(e.present("A"))
        e.on_sim_pad("A")
        self.assertTrue(e.present("A"))
        e.on_sim_pad("Z")
        self.assertEqual(e.present_plants(), ("A", "B"))


if __name__ == "__main__":
    unittest.main()
