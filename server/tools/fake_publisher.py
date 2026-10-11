# server/tools/fake_publisher.py: Pretends to be the pads and drying soil for testing without hardware. Owner: Role 2 (server).
"""Usage (from server/):  python tools/fake_publisher.py [--host HOST]

Puts a tag on pot A, dries pot A out until a boss appears, then wets it again when
the server sends a pump command. Press Ctrl+C to stop.
"""
import argparse
import time

import paho.mqtt.client as mqtt

ap = argparse.ArgumentParser()
ap.add_argument("--host", default="localhost")
ap.add_argument("--port", type=int, default=1883)
args = ap.parse_args()

soil = {"A": 1800.0, "B": 1800.0}
watered = {"A": False, "B": False}


def on_message(client, userdata, msg):
    pot = msg.topic.rsplit("/", 1)[-1]
    print("server command:", msg.topic, msg.payload.decode())
    if "pump" in msg.topic and pot in watered:
        watered[pot] = True


if hasattr(mqtt, "CallbackAPIVersion"):
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id="fake-esp32")
else:
    c = mqtt.Client(client_id="fake-esp32")
c.on_message = on_message
c.will_set("incube/status/esp32", "offline", retain=True)
c.connect(args.host, args.port)
c.subscribe("incube/cmd/#")
c.loop_start()
c.publish("incube/status/esp32", "online", retain=True)
c.publish("incube/pad/A", "04A1B2C3")
c.publish("incube/pad/B", "")
try:
    while True:
        for pot in ("A", "B"):
            if watered[pot]:
                soil[pot] = max(1500.0, soil[pot] - 200)       # drink
                watered[pot] = soil[pot] > 1500.0 and watered[pot]
            elif pot == "A":
                soil[pot] = min(3100.0, soil[pot] + 60)        # dry out (pot A only)
            c.publish(f"incube/soil/{pot}", int(soil[pot]))
        time.sleep(1)
except KeyboardInterrupt:
    c.publish("incube/status/esp32", "offline", retain=True).wait_for_publish()
