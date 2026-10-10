# server/app/mqtt_client.py: MQTT connection, subscriptions and publishing. Owner: Role 2 (server).


import asyncio
import json
import os

import paho.mqtt.client as mqtt
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import Plant


MQTT_HOST = os.getenv("MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = "plants/+/telemetry"


class SensorReading(BaseModel):
    plantId: str
    soilMoisture: float = Field(ge=0, le=100)
    lightIntensity: float = Field(ge=0)
    co2: float = Field(ge=0)


def start_mqtt(loop, broadcast_callback):
    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2
    )

    def on_connect(client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            print("MQTT connected")
            client.subscribe(MQTT_TOPIC)
        else:
            print("MQTT connection failed:", reason_code)

    def on_message(client, userdata, message):
        try:
            data = json.loads(message.payload.decode("utf-8"))
            reading = SensorReading.model_validate(data)

            expected_topic = f"plants/{reading.plantId}/telemetry"

            if message.topic != expected_topic:
                print("Rejected mismatched plant ID")
                return

            # Schedule database updates on FastAPI's event loop.
            future = asyncio.run_coroutine_threadsafe(
                process_reading(reading, broadcast_callback),
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


async def process_reading(reading, broadcast_callback):
    # One local demo process; database access is short-lived.
    with SessionLocal() as db:
        plant = db.get(Plant, reading.plantId)

        if plant is None:
            print("Unknown plant:", reading.plantId)
            return

        plant.soilMoisture = reading.soilMoisture
        plant.lightIntensity = reading.lightIntensity
        plant.co2 = reading.co2

        db.commit()

    await broadcast_callback()
