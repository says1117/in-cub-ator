"""MQTT glue. paho runs in its own thread, so messages are handed to asyncio safely."""
import asyncio

import paho.mqtt.client as mqtt

import config as C


def connect(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)

    def on_connect(c, userdata, flags, rc, props=None):
        topics = [C.TOPIC_STATUS_ESP32, C.TOPIC_DEBUG_BOSS]
        for p in C.PLANTS:
            topics += [C.TOPIC_PAD.format(plant=p), C.TOPIC_SOIL.format(plant=p)]
        for t in topics:
            c.subscribe(t)

    def on_message(c, userdata, msg):
        loop.call_soon_threadsafe(
            queue.put_nowait, (msg.topic, msg.payload.decode(errors="replace")))

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(C.MQTT_HOST, C.MQTT_PORT)
    client.loop_start()
    return client
