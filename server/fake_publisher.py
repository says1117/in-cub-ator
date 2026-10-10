"""Pretend to be the ESP32: python fake_publisher.py [--fast]

Soil A dries slowly until a boss appears, soil B stays wet. Run without hardware."""
import sys
import time

import paho.mqtt.client as mqtt

import config as C

fast = "--fast" in sys.argv
step = 150 if fast else 20

# Pretend pump effect: soil reading moves toward wet by this much per second of pumping
PUMP_RAW_PER_SECOND = 400
soil_raw = {"A": C.SOIL_RAW_WET, "B": C.SOIL_RAW_WET}


def on_pump(c, userdata, msg):
    plant = msg.topic.rsplit("/", 1)[-1]
    ms = int(msg.payload.decode())
    soil_raw[plant] = max(C.SOIL_RAW_WET, soil_raw[plant] - PUMP_RAW_PER_SECOND * ms // 1000)
    print("pump", plant, ms, "ms -> soil raw", soil_raw[plant])


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_message = on_pump
client.will_set(C.TOPIC_STATUS_ESP32, "offline", retain=True)
client.connect(C.MQTT_HOST, C.MQTT_PORT)
client.loop_start()
client.subscribe(C.TOPIC_CMD_PUMP.format(plant="+"))
client.publish(C.TOPIC_STATUS_ESP32, "online", retain=True)
client.publish(C.TOPIC_PAD.format(plant="A"), "04:A1:B2:C3")
client.publish(C.TOPIC_PAD.format(plant="B"), "04:D4:E5:F6")

soil_raw["A"] = C.SOIL_RAW_WET
while True:
    soil_raw["A"] = min(C.SOIL_RAW_DRY, soil_raw["A"] + step)  # soil A keeps drying
    for plant in C.PLANTS:
        client.publish(C.TOPIC_SOIL.format(plant=plant), str(soil_raw[plant]))
    print("soil A raw", soil_raw["A"])
    time.sleep(1)
