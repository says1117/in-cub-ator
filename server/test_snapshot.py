"""Tests for the game state message (schema 2). Run: python -m unittest test_snapshot -v  (from the server folder)"""
import json
import random
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
OLD_FIELDS = ("creatures", "meters", "mode", "fighters", "health", "condition", "tier", "boss", "battle", "reward")
WEAK_BOSS = {1: ("Weak", 1, 0), 2: ("Weak", 1, 0), 3: ("Weak", 1, 0)}


def engine():
    e = GameEngine(rng=random.Random(1), plant_db=P.PlantDB.load(progress_path=None))
    e.manual = True
    return e


def as_sent(e):
    """The snapshot exactly as api.py sends it over the WebSocket."""
    return json.loads(json.dumps(e.snapshot(), sort_keys=True))


class SchemaTests(unittest.TestCase):
    def test_old_engine_battle_log_has_no_database_fields(self):
        e = GameEngine(rng=random.Random(1), need_pads=False)
        e.manual = True
        e.on_demo_boss(0.0, "A")
        e.tick(INTRO_DONE)
        e.on_player_move("attack", INTRO_DONE + 1.0)
        for key in ("move_id", "actor_pad", "actor_plant_id"):
            self.assertNotIn(key, e.battle.last_move)

    def test_old_engine_says_schema_1_and_has_no_new_fields(self):
        snap = as_sent(GameEngine())
        self.assertEqual(snap["schema_version"], 1)
        for key in ("pads", "summoned_plants", "progress"):
            self.assertNotIn(key, snap)

    def test_every_old_field_is_still_there(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        snap = as_sent(e)
        self.assertEqual(snap["schema_version"], 2)
        for key in OLD_FIELDS:
            self.assertIn(key, snap)

    def test_pads(self):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        e.on_pad("B", "DEADBEEF", 0.0)
        pads = as_sent(e)["pads"]
        self.assertEqual(pads["A"], {"uid": EMBER, "plant_id": "ember", "status": "known"})
        self.assertEqual(pads["B"], {"uid": "DEADBEEF", "plant_id": None, "status": "unknown"})

    def test_summoned_plants_lists_only_plants_on_pads(self):
        e = engine()
        self.assertEqual(as_sent(e)["summoned_plants"], [])
        e.on_pad("B", ZEST, 0.0)
        plants = as_sent(e)["summoned_plants"]
        self.assertEqual([p["plant_id"] for p in plants], ["zest"])
        zest = plants[0]
        self.assertEqual(zest["pad_id"], "B")
        self.assertEqual(zest["level"], 1)
        self.assertEqual(zest["xp"], 0)
        self.assertEqual(zest["xp_to_next"], 50)
        self.assertEqual(zest["type"], "leaf")
        self.assertEqual(zest["sprite_key"], "plant-zest")
        self.assertEqual(zest["moves"], ["zest-blade-rush", "zest-stripe-wall", "zest-citrus-volt", "sunburst"])

    def test_max_level_has_no_next_threshold(self):
        e = engine()
        e.plant_db.xp["ember"] = 10 ** 6
        e.on_pad("A", EMBER, 0.0)
        self.assertIsNone(as_sent(e)["summoned_plants"][0]["xp_to_next"])


class BattleSchemaTests(unittest.TestCase):
    def into_battle(self, both=False):
        e = engine()
        e.on_pad("A", EMBER, 0.0)
        if both:
            e.on_pad("B", ZEST, 0.0)
        e.on_demo_boss(0.0, "A")
        e.tick(INTRO_DONE)
        return e, INTRO_DONE + 1.0

    def test_move_buttons_come_from_the_fighting_plant(self):
        e, _ = self.into_battle()
        battle = as_sent(e)["battle"]
        self.assertEqual(battle["active_plant_id"], "ember")
        self.assertTrue(battle["battle_id"])
        moves = battle["moves"]
        self.assertEqual([m["move_id"] for m in moves], ["ember-vine-haymaker", "ember-petal-aegis", "ember-flamingo-flare", "inferno-bloom"])
        self.assertEqual(moves[0]["animation"], {"body": "strike", "fx": "haymaker"})
        self.assertTrue(all(m["ready"] for m in moves if m["category"] != "skill"))
        skill = [m for m in moves if m["category"] == "skill"][0]
        self.assertEqual(skill["ready"], B.skill_ready(e.battle))

    def test_skill_button_shows_not_ready_while_recharging(self):
        e, t = self.into_battle()
        e.battle = replace(e.battle, charge=C.SKILL_CHARGE_NEED)
        e.on_player_move("inferno-bloom", t)
        self.assertEqual(e.battle.last_move.get("move_id"), "inferno-bloom")  # the skill was used
        skill = [m for m in as_sent(e)["battle"]["moves"] if m["category"] == "skill"][0]
        self.assertFalse(skill["ready"])

    def test_last_action_names_the_plant_and_the_animation(self):
        e, t = self.into_battle()
        e.on_player_move("ember-flamingo-flare", t)
        last = as_sent(e)["battle"]["last_action"]
        self.assertEqual(last["actor_plant_id"], "ember")
        self.assertEqual(last["move_id"], "ember-flamingo-flare")
        self.assertEqual(last["animation_key"], "ember-flamingo-flare")
        self.assertEqual(last["animation"], {"body": "cast", "fx": "flare"})

    def test_after_a_swap_the_last_move_belongs_to_the_plant_that_left(self):
        e, t = self.into_battle(both=True)
        e.on_player_move("ember-vine-haymaker", t)
        e.battle = B._send_in_next(replace(e.battle, creature_hp=0))
        battle = as_sent(e)["battle"]
        self.assertEqual(battle["active_plant_id"], "zest")
        self.assertEqual(battle["last_action"]["actor_plant_id"], "ember")
        self.assertEqual(battle["moves"][0]["move_id"], "zest-blade-rush")  # the buttons are now Zest's
        self.assertEqual(battle["team_plants"]["A"]["plant_id"], "ember")
        self.assertEqual(battle["team_plants"]["B"]["plant_id"], "zest")

    def test_lifting_the_fighter_keeps_who_made_the_last_move(self):
        e, t = self.into_battle(both=True)
        e.on_player_move("ember-vine-haymaker", t)
        e.on_pad("A", "", t + 0.1)  # Ember is lifted, Zest steps in
        battle = as_sent(e)["battle"]
        self.assertEqual(battle["active_plant_id"], "zest")
        self.assertEqual(battle["last_action"]["actor_plant_id"], "ember")
        self.assertEqual(battle["last_action"]["move_id"], "ember-vine-haymaker")
        self.assertEqual(battle["last_move"]["swap"]["reason"], "lifted")

    def test_a_lift_before_any_turn_has_no_last_action(self):
        e, t = self.into_battle(both=True)
        e.on_pad("A", "", t)
        self.assertIsNone(as_sent(e)["battle"]["last_action"])

    def test_no_last_action_before_the_first_turn(self):
        e, _ = self.into_battle()
        self.assertIsNone(as_sent(e)["battle"]["last_action"])

    def test_the_old_battle_fields_are_still_there(self):
        e, _ = self.into_battle()
        battle = as_sent(e)["battle"]
        for key in ("turn", "plant", "team", "creature", "creature_hp", "boss_hp", "last_move", "skill", "manual"):
            self.assertIn(key, battle)


class ProgressSchemaTests(unittest.TestCase):
    def test_the_last_xp_award_is_in_the_message(self):
        with mock.patch.object(C, "BOSS_TIERS", WEAK_BOSS):
            e = engine()
            e.manual = False
            e.on_pad("A", EMBER, 0.0)
            t = 0.0
            for _ in range(C.SOIL_DRY_READINGS_N):
                e.on_soil_raw("A", C.SOIL_RAW_DRY, t)
            for _ in range(4000):
                t += 0.5
                e.tick(t)
                if e.game.mode == S.REWARD:
                    break
        snap = as_sent(e)
        self.assertEqual(e.game.mode, S.REWARD)
        self.assertEqual(snap["progress"]["last_xp"]["ember"]["gained"], C.XP_PER_WIN_BY_TIER[3])
        self.assertFalse(snap["progress"]["unsaved"])
        self.assertFalse(snap["progress"]["persistent"])  # this test runs without a save file
        self.assertEqual(snap["summoned_plants"][0]["xp"], C.XP_PER_WIN_BY_TIER[3])


if __name__ == "__main__":
    unittest.main()
