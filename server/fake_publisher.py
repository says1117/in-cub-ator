"""Pretend to be the ESP32: python fake_publisher.py [--fast]

Soil A dries slowly until a boss appears, soil B stays wet. Run without hardware."""
import sys
import time

import paho.mqtt.client as mqtt

import config as C

fast = "--fast" in sys.argv
step = 150 if fast else 20

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.will_set(C.TOPIC_STATUS_ESP32, "offline", retain=True)
client.connect(C.MQTT_HOST, C.MQTT_PORT)
client.loop_start()
client.publish(C.TOPIC_STATUS_ESP32, "online", retain=True)
client.publish(C.TOPIC_PAD.format(plant="A"), "04:A1:B2:C3")
client.publish(C.TOPIC_PAD.format(plant="B"), "04:D4:E5:F6")

raw_a = C.SOIL_RAW_WET
while True:
    raw_a = min(C.SOIL_RAW_DRY, raw_a + step)
    client.publish(C.TOPIC_SOIL.format(plant="A"), str(raw_a))
    client.publish(C.TOPIC_SOIL.format(plant="B"), str(C.SOIL_RAW_WET))
    print("soil A raw", raw_a)
    time.sleep(1)
