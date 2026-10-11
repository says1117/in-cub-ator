"""Run from server: .venv/bin/python -m unittest discover -s tests -p test_watering_reward.py"""
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main, database
from app.database import Base
from app.models import Plant, WateringCooldown


class WateringRewardTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.directory.name}/plants.db",
            connect_args={"check_same_thread": False}
        )
        self.sessions = sessionmaker(bind=self.engine)
        self.patches = [
            patch.object(main, "engine", self.engine),
            patch.object(main, "SessionLocal", self.sessions),
            patch.object(database, "SessionLocal", self.sessions),
            patch.object(main, "start_mqtt", return_value=Mock()),
        ]
        for item in self.patches:
            item.start()
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for item in reversed(self.patches):
            item.stop()
        self.engine.dispose()
        self.directory.cleanup()

    def reward(self, battle_id, plant="PLANT_001"):
        return self.client.post(
            f"/api/plants/{plant}/watering-reward", json={"battleId": battle_id}
        )

    def test_victory_updates_database_and_websocket_only_target_plant(self):
        with self.client.websocket_connect(
            "/ws/plants", headers={"origin": "http://localhost:5173"}
        ) as socket:
            initial = socket.receive_json()
            response = self.reward(str(uuid4()))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["simulated"])
            message = socket.receive_json()
            self.assertEqual(message["type"], "plants_updated")
            self.assertEqual(message["plants"][0]["soilMoisture"], 90)
            self.assertEqual(message["plants"][1], initial["plants"][1])
            for field in ("hp", "level", "lightIntensity", "co2"):
                self.assertEqual(message["plants"][0][field], initial["plants"][0][field])
        self.assertEqual(self.client.get("/api/plants/PLANT_001").json()["soilMoisture"], 90)
        with self.sessions() as db:
            self.assertEqual(db.get(Plant, "PLANT_001").soilMoisture, 90)

    def test_full_transition_upgrades_stats_once_and_survives_restart(self):
        with self.client.websocket_connect('/ws/plants', headers={'origin':'http://localhost:5173'}) as socket:
            before=socket.receive_json()['plants'][0]
            self.reward('upgrade-first'); socket.receive_json()
            self.reward('upgrade-full')
            full=socket.receive_json()['plants'][0]
            old, new=before['combatStats'], full['combatStats']
            self.assertEqual(new['maxHp'], old['maxHp']+5)
            self.assertEqual(new['attackDamage'], old['attackDamage']+1)
            self.assertEqual(new['shield'], old['shield']+1)
            self.reward('upgrade-full')
            self.assertEqual(socket.receive_json()['plants'][0]['combatStats'], new)
            self.reward('upgrade-blocked')
            self.assertEqual(socket.receive_json()['plants'][0]['combatStats'], new)
        self.client.__exit__(None,None,None)
        self.client=TestClient(main.app); self.client.__enter__()
        self.assertEqual(self.client.get('/api/plants/PLANT_001').json()['combatStats'],new)

    def test_duplicate_survives_server_restart_and_rebroadcasts(self):
        battle_id = str(uuid4())
        self.reward(battle_id)
        self.client.__exit__(None, None, None)
        self.client = TestClient(main.app)
        self.client.__enter__()
        with self.client.websocket_connect(
            "/ws/plants", headers={"origin": "http://localhost:5173"}
        ) as socket:
            socket.receive_json()
            response = self.reward(battle_id)
            self.assertTrue(response.json()["alreadyRewarded"])
            self.assertEqual(socket.receive_json()["plants"][0]["soilMoisture"], 90)
        self.assertEqual(self.reward(battle_id, "PLANT_002").status_code, 409)

    def test_moisture_caps_at_one_hundred(self):
        self.reward(str(uuid4()))
        response = self.reward(str(uuid4())).json()
        self.assertEqual(response["soilMoisture"], 100)
        self.assertEqual(response["increase"], 10)
        self.assertEqual(self.reward(str(uuid4())).json()["increase"], 0)

    def test_manual_watering_rejected_for_both_plants_without_mutation(self):
        from app.models import ManualWatering, HardwareWatering
        before = self.client.get("/api/plants").json()
        for plant in before:
            response = self.client.post(f"/api/plants/{plant['plantId']}/water",
                                        json={"requestId": str(uuid4())})
            self.assertEqual(response.status_code, 403)
            self.assertIn("Defeat a boss", response.json()["detail"])
        self.assertEqual(self.client.get("/api/plants").json(), before)
        with self.sessions() as db:
            self.assertEqual(db.query(ManualWatering).count(), 0)
            self.assertEqual(db.query(HardwareWatering).count(), 0)

    def test_manual_watering_disabled_in_hardware_mode_without_pump(self):
        from unittest.mock import AsyncMock
        runtime = main.app.state.game
        runtime.simulation = False
        runtime.hardware_water = AsyncMock()
        response = self.client.post("/api/plants/PLANT_001/water", json={"requestId": "hardware"})
        self.assertEqual(response.status_code, 403)
        runtime.hardware_water.assert_not_awaited()
        self.assertEqual(self.client.post("/api/plants/missing/water", json={"requestId": "missing"}).status_code, 404)
        self.assertEqual(self.client.post("/api/plants/PLANT_001/water", json={"requestId": ""}).status_code, 422)

    def test_full_moisture_levels_once_and_blocks_both_water_sources(self):
        with self.client.websocket_connect(
            "/ws/plants", headers={"origin": "http://localhost:5173"}
        ) as socket:
            initial = socket.receive_json()["plants"][0]
            self.reward("first")
            socket.receive_json()
            response = self.reward("full")
            self.assertEqual(response.json()["level"], initial["level"] + 1)
            updated = socket.receive_json()["plants"][0]
            self.assertEqual(updated["soilMoisture"], 100)
            self.assertEqual(updated["level"], initial["level"] + 1)
            for endpoint, body in [("watering-reward", {"battleId": "full"}),
                                   ("watering-reward", {"battleId": "extra"})]:
                response = self.client.post(f"/api/plants/PLANT_001/{endpoint}", json=body).json()
                self.assertTrue(response["wateringBlocked"])
                self.assertEqual(response["level"], updated["level"])
                self.assertEqual(socket.receive_json()["plants"][0], updated)
        self.client.__exit__(None, None, None)
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.assertEqual(self.reward("after-restart").json()["level"], updated["level"])

    def test_sensor_and_patch_full_readings_do_not_repeat_level_up(self):
        import asyncio
        from app import mqtt_client
        from unittest.mock import AsyncMock
        for moisture in [100, 100]:
            response = self.client.patch("/api/plants/PLANT_001", json={"soilMoisture": moisture})
            self.assertEqual(response.json()["level"], 6)
        with patch.object(mqtt_client, "SessionLocal", self.sessions):
            callback = AsyncMock()
            reading = mqtt_client.SensorReading(plantId="PLANT_002", soilMoisture=100, lightIntensity=1200, co2=40)
            asyncio.run(mqtt_client.process_reading(reading, callback))
            asyncio.run(mqtt_client.process_reading(reading, callback))
        self.assertEqual(self.client.get("/api/plants/PLANT_002").json()["level"], 4)

    def test_full_hold_expires_through_websocket_and_watering_resumes(self):
        import time
        with self.client.websocket_connect(
            "/ws/plants", headers={"origin": "http://localhost:5173"}
        ) as socket:
            socket.receive_json()
            self.client.patch("/api/plants/PLANT_001", json={"soilMoisture": 90})
            socket.receive_json()
            started = time.time()
            response = self.reward("reach-full").json()
            full = socket.receive_json()["plants"][0]
            self.assertEqual(full["level"], 6)
            self.assertAlmostEqual(full["wateringAvailableAt"] - started, 10, delta=1)
            self.client.patch("/api/plants/PLANT_001", json={"soilMoisture": 20})
            self.assertEqual(socket.receive_json()["plants"][0]["soilMoisture"], 100)
            self.assertEqual(self.reward("blocked-win").json()["increase"], 0)
            socket.receive_json()
            # Restart during the hold: the original persisted deadline remains.
            deadline = full["wateringAvailableAt"]
            with self.sessions() as db:
                self.assertEqual(db.get(WateringCooldown, "PLANT_001").until, deadline)
            reset = socket.receive_json()["plants"][0]
            self.assertGreaterEqual(time.time(), deadline)
            self.assertEqual(reset["soilMoisture"], 60)
            self.assertEqual(reset["level"], 6)
            self.assertIsNone(reset["wateringAvailableAt"])
            replay = self.reward("blocked-win").json()
            self.assertEqual(replay["increase"], 0)
            self.assertEqual(socket.receive_json()["plants"][0]["soilMoisture"], 60)
            self.reward("resume")
            self.assertEqual(socket.receive_json()["plants"][0]["soilMoisture"], 80)
            self.reward("next-win")
            next_full = socket.receive_json()["plants"][0]
            self.assertEqual(next_full["soilMoisture"], 100)
            self.assertEqual(next_full["level"], 7)
            denied = self.client.post("/api/plants/PLANT_001/water", json={"requestId": "next-level"})
            self.assertEqual(denied.status_code, 403)

    def test_restart_after_expiry_resets_to_sixty_without_new_hold(self):
        import time
        self.client.patch("/api/plants/PLANT_001", json={"soilMoisture": 100})
        self.client.__exit__(None, None, None)
        with self.sessions() as db:
            db.get(WateringCooldown, "PLANT_001").until = time.time() - 1
            db.commit()
        self.client = TestClient(main.app)
        self.client.__enter__()
        plant = self.client.get("/api/plants/PLANT_001").json()
        self.assertEqual(plant["soilMoisture"], 60)
        self.assertEqual(plant["level"], 6)
        self.assertIsNone(plant["wateringAvailableAt"])

    def test_simulator_light_and_co2_update_each_plant_without_changing_moisture(self):
        from app import mqtt_client
        self.client.patch("/api/plants/PLANT_001", json={"soilMoisture": 100})
        with patch.object(mqtt_client, "SessionLocal", self.sessions):
            with self.client.websocket_connect(
                "/ws/plants", headers={"origin": "http://localhost:5173"}
            ) as socket:
                previous = socket.receive_json()["plants"]
                for index, plant_id in enumerate(["PLANT_001", "PLANT_002"]):
                    reading = mqtt_client.SensorReading.model_validate({
                        "plantId": plant_id, "lightIntensity": 501 + index, "co2": 61 + index
                    })
                    self.assertIsNone(reading.soilMoisture)
                    self.client.portal.call(mqtt_client.process_reading, reading, main.broadcast_plants)
                    updated = socket.receive_json()["plants"]
                    self.assertEqual(updated[index]["lightIntensity"], 501 + index)
                    self.assertEqual(updated[index]["co2"], 61 + index)
                    for field in ["soilMoisture", "level", "wateringAvailableAt", "hp"]:
                        self.assertEqual(updated[index][field], previous[index][field])
                    self.assertEqual(updated[1 - index], previous[1 - index])
                    stored = self.client.get(f"/api/plants/{plant_id}").json()
                    self.assertEqual(stored, updated[index])
                    previous = updated

    def test_optional_moisture_still_validates_provided_sensor_values(self):
        from app.mqtt_client import SensorReading
        from pydantic import ValidationError
        for changes in [{"soilMoisture": -1}, {"soilMoisture": 101},
                        {"lightIntensity": -1}, {"co2": -1}]:
            with self.assertRaises(ValidationError):
                SensorReading.model_validate({
                    "plantId": "PLANT_001", "lightIntensity": 500, "co2": 60, **changes
                })

    def test_invalid_requests_do_not_award_water(self):
        self.assertEqual(self.reward(str(uuid4()), "missing").status_code, 404)
        self.assertEqual(self.reward("").status_code, 422)
        with self.sessions() as db:
            self.assertEqual(db.get(Plant, "PLANT_001").soilMoisture, 70)


    def test_soil_only_sensor_update_preserves_light_and_co2(self):
        import asyncio
        from app import mqtt_client
        before = self.client.get("/api/plants/PLANT_001").json()
        reading = mqtt_client.SensorReading(plantId="PLANT_001", soilMoisture=35)
        callback = __import__("unittest.mock", fromlist=["AsyncMock"]).AsyncMock()
        with patch.object(mqtt_client, "SessionLocal", self.sessions):
            asyncio.run(mqtt_client.process_reading(reading, callback))
        after = self.client.get("/api/plants/PLANT_001").json()
        self.assertEqual(after["soilMoisture"], 35)
        self.assertEqual(after["lightIntensity"], before["lightIntensity"])
        self.assertEqual(after["co2"], before["co2"])
        callback.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
