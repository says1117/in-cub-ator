# server/app/mqtt_client.py: MQTT connection, subscriptions and publishing. Owner: Role 2 (server).
from __future__ import annotations

import logging
from typing import Callable

import paho.mqtt.client as mqtt

import config

log = logging.getLogger("incube.mqtt")

SUBSCRIPTIONS = ["incube/pad/+", "incube/soil/+", "incube/status/esp32", "incube/debug/boss"]


class Mqtt:
    """Thin paho wrapper. `on_message(topic, payload_str)` runs on paho's thread."""

    def __init__(self, on_message: Callable[[str, str], None]):
        self._on_message = on_message
        if hasattr(mqtt, "CallbackAPIVersion"):                       # paho 2.x
            self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id="incube-server")
        else:                                                         # paho 1.x
            self.client = mqtt.Client(client_id="incube-server")
        if config.MQTT_USER:
            self.client.username_pw_set(config.MQTT_USER, config.MQTT_PASSWORD)
        self.client.reconnect_delay_set(min_delay=1, max_delay=10)
        self.client.on_connect = self._connected
        self.client.on_message = self._message
        self.client.on_disconnect = lambda *a, **k: log.warning("MQTT disconnected")
        self.connected = False

    def start(self) -> None:
        # connect_async + loop_start keeps retrying if the broker is not up yet.
        self.client.connect_async(config.MQTT_HOST, config.MQTT_PORT, keepalive=30)
        self.client.loop_start()

    def stop(self) -> None:
        self.client.loop_stop()
        try:
            self.client.disconnect()
        except Exception:
            pass

    def _connected(self, client, userdata, flags, rc, *extra):
        if rc != 0:
            log.error("MQTT connect refused, rc=%s", rc)
            return
        self.connected = True
        log.info("MQTT connected to %s:%s", config.MQTT_HOST, config.MQTT_PORT)
        for topic in SUBSCRIPTIONS:
            client.subscribe(topic)

    def _message(self, client, userdata, msg):
        try:
            self._on_message(msg.topic, msg.payload.decode("utf-8", "replace"))
        except Exception:
            log.exception("bad message on %s", msg.topic)

    def publish(self, topic: str, payload) -> None:
        log.info("-> %s %s", topic, payload)
        self.client.publish(topic, str(payload), qos=1)
