# server/app/mqtt_client.py: MQTT connection, subscriptions and publishing. Owner: Role 2 (server).


import asyncio
import json
import os

import paho.mqtt.client as mqtt
from pydantic import BaseModel, Field, ValidationError

from .database import SessionLocal
from .models import Plant
from .progression import update_moisture
from .game import config as C
from .game.state_machine import soil_pct


MQTT_HOST = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = "plants/+/telemetry"


class SensorReading(BaseModel):
    plantId: str
    soilMoisture: float | None = Field(default=None, ge=0, le=100)
    lightIntensity: float | None = Field(default=None, ge=0)
    co2: float | None = Field(default=None, ge=0)


def start_mqtt(loop, broadcast_callback, game_callback=None):
    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2
    )



    def on_connect(client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            print("MQTT connected")
            client.subscribe([(MQTT_TOPIC, 0), ("incube/soil/+", 0), ("incube/pad/+", 0),
                              (C.TOPIC_STATUS_ESP32, 0), (C.TOPIC_DEBUG_BOSS, 0)])
        else:
            print("MQTT connection failed:", reason_code)

    def on_message(client, userdata, message):
        try:
            text = message.payload.decode("utf-8")
            if message.topic.startswith("incube/"):
                async def handle_hardware():
                    topic = message.topic
                    if topic == C.TOPIC_STATUS_ESP32 and game_callback:
                        game_callback({"type": "status", "status": text})
                    elif topic == C.TOPIC_DEBUG_BOSS and game_callback:
                        slot = text.strip().upper()
                        if slot in C.PLANTS:
                            game_callback({"type": "demo", "slot": slot})
                    elif topic.startswith("incube/pad/") and game_callback:
                        game_callback({"type": "pad", "slot": topic.split("/")[-1], "uid": text})
                    elif topic.startswith("incube/soil/"):
                        slot = topic.split("/")[-1]
                        raw = int(float(text))
                        if slot not in C.PLANTS or not 0 <= raw <= 4095:
                            return
                        with SessionLocal() as db:
                            rows = db.query(Plant).order_by(Plant.plantId).all()[:2]
                            if len(rows) <= C.PLANTS.index(slot):
                                return
                            plant = rows[C.PLANTS.index(slot)]
                            update_moisture(plant, soil_pct(raw), db)
                            db.commit()
                        if game_callback:
                            game_callback({"type": "soil", "slot": slot})
                        await broadcast_callback()
                future = asyncio.run_coroutine_threadsafe(handle_hardware(), loop)
                future.add_done_callback(lambda f: print("Hardware telemetry error:", f.exception())
                                         if not f.cancelled() and f.exception() else None)
                return
            data = json.loads(text)
            reading = SensorReading.model_validate(data)

            expected_topic = f"plants/{reading.plantId}/telemetry"

            if message.topic != expected_topic:
                print("Rejected mismatched plant ID")
                return

            # Schedule database updates on FastAPI's event loop.
            future = asyncio.run_coroutine_threadsafe(
                process_reading(reading, broadcast_callback, game_callback),
                loop
            )

            future.add_done_callback(
                lambda f: print("MQTT processing error:", f.exception())
                if not f.cancelled() and f.exception()
                else None
            )

        except (ValueError, ValidationError) as error:
            print("Invalid sensor data:", error)

    client.on_connect = on_connect
    client.on_message = on_message

    

    client.connect_async(MQTT_HOST, MQTT_PORT, 60)
    client.loop_start()

    return client


async def process_reading(reading, broadcast_callback, game_callback=None):
    # One local demo process; database access is short-lived.
    with SessionLocal() as db:
        plant = db.get(Plant, reading.plantId)

        if plant is None:
            print("Unknown plant:", reading.plantId)
            return

        # Light/CO₂-only telemetry must not overwrite watering or its cooldown.
        if reading.soilMoisture is not None:
            update_moisture(plant, reading.soilMoisture, db)
        if reading.lightIntensity is not None:
            plant.lightIntensity = reading.lightIntensity
        if reading.co2 is not None:
            plant.co2 = reading.co2

        db.commit()

    if game_callback and reading.soilMoisture is not None:
        game_callback({"type": "soil", "plantId": reading.plantId})
    await broadcast_callback()
