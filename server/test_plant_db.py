"""Tests for the plant database. Run: python -m unittest test_plant_db -v  (from the server folder)"""
import json
import os
import sqlite3
import tempfile
import unittest

import config as C
import plant_db as P

EMBER_UID = "0450AA01F25713"
ZEST_UID = "0450A901055713"


class TempFiles(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def path(self, name):
        return os.path.join(self.dir.name, name)

    def write(self, name, data):
        with open(self.path(name), "w") as f:
            json.dump(data, f)
        return self.path(name)

    def real_db(self, progress=True, background=False):
        return P.PlantDB.load(progress_path=self.path("progress.db") if progress else None,
                              background=background)


class UidTests(unittest.TestCase):
    def test_firmware_form_is_kept(self):
        self.assertEqual(P.normalize_uid(EMBER_UID), EMBER_UID)

    def test_colons_spaces_dashes_and_case_are_cleaned(self):
        self.assertEqual(P.normalize_uid(" 04:50:aa:01-f2 57 13 "), EMBER_UID)

    def test_empty_means_empty_pad(self):
        self.assertEqual(P.normalize_uid(""), "")
        self.assertEqual(P.normalize_uid("   "), "")
        self.assertEqual(P.normalize_uid(None), "")

    def test_not_a_tag_is_none(self):
        for bad in ("not-a-tag", "0450AA0", "0450AA01F257131", "04" * 11, "ZZ50AA01"):
            self.assertIsNone(P.normalize_uid(bad), bad)

    def test_leading_zeros_are_kept(self):
        self.assertEqual(P.normalize_uid("000000FF"), "000000FF")


class SeedDataTests(TempFiles):
    def test_the_real_files_load(self):
        db = self.real_db(progress=False)
        self.assertEqual(set(db.plants), {"ember", "zest"})
        self.assertEqual(db.lookup(EMBER_UID).name, "Ember")
        self.assertEqual(db.lookup(ZEST_UID).name, "Zest")

    def test_lookup_cleans_the_uid_and_rejects_unknown_tags(self):
        db = self.real_db(progress=False)
        self.assertEqual(db.lookup("04:50:aa:01:f2:57:13").plant_id, "ember")
        self.assertIsNone(db.lookup("DEADBEEF"))
        self.assertIsNone(db.lookup(""))
        self.assertIsNone(db.lookup("garbage"))

    def test_every_plant_has_one_move_per_category(self):
        db = self.real_db(progress=False)
        for plant in db.plants.values():
            moves = db.moves_of(plant)
            self.assertEqual(set(moves), set(C.MOVE_CATEGORIES))
            for category, move in moves.items():
                self.assertEqual(move.category, category)
                self.assertTrue(move.animation_key)

    def test_seed_stats_match_the_old_default_fighters(self):
        # The balance tests were tuned with these numbers; keep them until the team rebalances.
        db = self.real_db(progress=False)
        self.assertEqual(P.stats_at_level(db.plants["ember"], 1), (30, 8))
        self.assertEqual(P.stats_at_level(db.plants["zest"], 1), (34, 7))

    def bad_catalog(self, plants=None, moves=None):
        good_moves = json.load(open(C.MOVES_FILE))
        good_plants = json.load(open(C.PLANTS_FILE))
        mp = self.write("moves.json", moves if moves is not None else good_moves)
        pp = self.write("plants.json", plants if plants is not None else good_plants)
        return lambda: P.PlantDB.load(pp, mp, None)

    def test_bad_data_is_refused_with_a_clear_reason(self):
        plants = json.load(open(C.PLANTS_FILE))
        cases = []
        dup = json.loads(json.dumps(plants)); dup["plants"][1]["tag_uid"] = EMBER_UID; cases.append(dup)
        bad_uid = json.loads(json.dumps(plants)); bad_uid["plants"][0]["tag_uid"] = "nope"; cases.append(bad_uid)
        missing = json.loads(json.dumps(plants)); del missing["plants"][0]["moves"]["guard"]; cases.append(missing)
        wrong = json.loads(json.dumps(plants)); wrong["plants"][0]["moves"]["guard"] = "ember-vine-haymaker"; cases.append(wrong)
        skill = json.loads(json.dumps(plants)); skill["plants"][0]["skill"] = "bark_shield"; cases.append(skill)
        for case in cases:
            with self.assertRaises(ValueError):
                self.bad_catalog(plants=case)()

    def test_wrong_kinds_of_values_are_refused(self):
        plants = json.load(open(C.PLANTS_FILE))
        moves = json.load(open(C.MOVES_FILE))
        cases = []
        for field, value in (("base_hp", 30.5), ("base_hp", True), ("base_hp", 0), ("name", ""),
                             ("tag_uid", 1234), ("moves", "ember-vine-haymaker")):
            c = json.loads(json.dumps(plants)); c["plants"][0][field] = value; cases.append(("plants", c))
        gone = json.loads(json.dumps(plants)); del gone["plants"][0]["species"]; cases.append(("plants", gone))
        extra = json.loads(json.dumps(plants)); extra["plants"][0]["colour"] = "red"; cases.append(("plants", extra))
        notobj = json.loads(json.dumps(plants)); notobj["plants"][0] = "ember"; cases.append(("plants", notobj))
        mv = json.loads(json.dumps(moves)); del mv["moves"][0]["animation_key"]; cases.append(("moves", mv))
        mv2 = json.loads(json.dumps(moves)); mv2["moves"][0]["power"] = "100"; cases.append(("moves", mv2))
        mv3 = json.loads(json.dumps(moves)); mv3["moves"][0]["animation"] = {"body": "strike"}; cases.append(("moves", mv3))
        mv4 = json.loads(json.dumps(moves)); del mv4["moves"][0]["animation"]; cases.append(("moves", mv4))
        for kind, case in cases:
            with self.assertRaises(ValueError, msg=str(case)[:80]):
                (self.bad_catalog(plants=case) if kind == "plants" else self.bad_catalog(moves=case))()

    def test_bad_moves_are_refused(self):
        moves = json.load(open(C.MOVES_FILE))
        strong = json.loads(json.dumps(moves)); strong["moves"][0]["power"] = 500
        cat = json.loads(json.dumps(moves)); cat["moves"][0]["category"] = "dance"
        sk = json.loads(json.dumps(moves)); sk["moves"][3]["skill_key"] = "nope"
        for case in (strong, cat, sk):
            with self.assertRaises(ValueError):
                self.bad_catalog(moves=case)()


class LevelTests(unittest.TestCase):
    def test_level_thresholds(self):
        self.assertEqual([P.xp_to_reach(L) for L in (1, 2, 3, 4)], [0, 50, 150, 300])
        self.assertEqual(P.level_for_xp(0), 1)
        self.assertEqual(P.level_for_xp(49), 1)
        self.assertEqual(P.level_for_xp(50), 2)
        self.assertEqual(P.level_for_xp(150), 3)

    def test_level_is_capped(self):
        self.assertEqual(P.level_for_xp(10 ** 9), C.MAX_LEVEL)

    def test_stats_grow_modestly(self):
        plant = P.PlantDB.load(progress_path=None).plants["ember"]
        self.assertEqual(P.stats_at_level(plant, 3), (34, 9))
        self.assertEqual(P.stats_at_level(plant, 99), P.stats_at_level(plant, C.MAX_LEVEL))


class ProgressTests(TempFiles):
    def test_xp_is_paid_once_per_battle(self):
        db = self.real_db()
        first = db.award("battle-1", ["ember"], 20)
        self.assertEqual(first["ember"]["xp"], 20)
        self.assertEqual(db.award("battle-1", ["ember"], 20), {})
        self.assertEqual(db.xp["ember"], 20)

    def test_level_up_is_reported(self):
        db = self.real_db()
        db.award("b1", ["zest"], 45)
        result = db.award("b2", ["zest"], 10)
        self.assertTrue(result["zest"]["levelled_up"])
        self.assertEqual(result["zest"]["level"], 2)

    def test_progress_survives_a_restart(self):
        db = self.real_db()
        db.award("b1", ["ember", "zest"], 30)
        again = self.real_db()
        self.assertEqual(again.xp, {"ember": 30, "zest": 30})

    def test_unknown_plants_and_zero_xp_are_ignored(self):
        db = self.real_db()
        self.assertEqual(db.award("b1", ["nobody"], 20), {})
        self.assertEqual(db.award("b2", ["ember"], 0), {})
        self.assertEqual(db.xp["ember"], 0)

    def test_a_failed_save_keeps_progress_and_catches_up_later(self):
        db = self.real_db()
        real_store = db.store

        class Broken:
            def save(self, rows):
                raise sqlite3.OperationalError("disk full")

        db.store = Broken()
        db.award("b1", ["ember"], 20)
        self.assertTrue(db.unsaved)
        self.assertEqual(db.xp["ember"], 20)
        db.store = real_store
        db.award("b2", ["zest"], 20)
        self.assertFalse(db.unsaved)
        totals, battles = real_store.load()
        self.assertEqual(totals, {"ember": 20, "zest": 20})
        self.assertEqual(battles, {"b1", "b2"})  # the failed battle's record was saved too

    def test_a_replayed_battle_after_a_restart_pays_nothing(self):
        db = self.real_db()
        db.award("b1", ["ember"], 20)
        again = self.real_db()
        self.assertEqual(again.award("b1", ["ember"], 20), {})
        self.assertEqual(again.xp["ember"], 20)
        self.assertEqual(self.real_db().xp["ember"], 20)

    def test_a_corrupt_progress_file_does_not_stop_the_game(self):
        with open(self.path("progress.db"), "w") as f:
            f.write("this is not a database")
        db = self.real_db()
        self.assertEqual(db.level("ember"), 1)
        self.assertEqual(db.award("b1", ["ember"], 20)["ember"]["xp"], 20)  # still plays, in memory

    def test_background_saving(self):
        db = self.real_db(background=True)
        db.award("b1", ["ember"], 20)
        for _ in range(100):
            if not db.unsaved:
                break
            import time
            time.sleep(0.02)
        self.assertFalse(db.unsaved)
        self.assertEqual(self.real_db().xp["ember"], 20)

    def test_no_store_works_in_memory(self):
        db = self.real_db(progress=False)
        self.assertEqual(db.award("b1", ["ember"], 20)["ember"]["xp"], 20)


if __name__ == "__main__":
    unittest.main()
