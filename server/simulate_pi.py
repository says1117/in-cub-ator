
import json
import os
import random
import time

import paho.mqtt.client as mqtt


client = mqtt.Client(
    callback_api_version=mqtt.CallbackAPIVersion.VERSION2
)

client.connect(os.getenv("MQTT_HOST", "127.0.0.1"), int(os.getenv("MQTT_PORT", "1883")), 60)
client.loop_start()

print("Simulated Raspberry Pi started")

try:
    while True:
        reading1 = {
            "plantId": "PLANT_001",
            # Moisture is controlled by watering; simulate light and CO₂ only.
            "lightIntensity": random.randint(500, 1500),
            "co2": random.randint(60, 100)
        }

        client.publish(
            "plants/PLANT_001/telemetry",
            json.dumps(reading1),
            qos=1
        )

        print("Published:", reading1)


        reading2 = {
            "plantId": "PLANT_002",
            # Moisture is controlled by watering; simulate light and CO₂ only.
            "lightIntensity": random.randint(500, 1500),
            "co2": random.randint(60, 100)
        }

        client.publish(
            "plants/PLANT_002/telemetry",
            json.dumps(reading2),
            qos=1
        )

        print("Published:", reading2)

        time.sleep(2)

except KeyboardInterrupt:
    print("Stopping simulator")

finally:
    client.loop_stop()
    client.disconnect()
