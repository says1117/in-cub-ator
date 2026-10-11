"""MQTT glue. paho runs in its own thread, so messages are handed to asyncio safely.

`LoopbackBus` stands in for the broker in `--offline` mode: whatever is published is handed
straight back to the server's own queue, so the simulator and the game run with no Mosquitto."""
import asyncio

import config as C


def connect(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
    import paho.mqtt.client as mqtt  # only needed when a real broker is used

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


class LoopbackBus:
    """A broker in a box: publish() delivers to this process's own queue, on the event loop."""

    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self.loop = loop
        self.queue = queue

    def publish(self, topic: str, payload, qos: int = 0):
        self.loop.call_soon(self.queue.put_nowait, (topic, str(payload)))
        return None
