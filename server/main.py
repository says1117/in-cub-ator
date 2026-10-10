"""Run the game server: python main.py"""
import asyncio
import logging
import time

import api
import battle
import config as C
import mqtt_io
from engine import GameEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("main")


def route(engine: GameEngine, topic: str, payload: str, now: float) -> list:
    if topic == C.TOPIC_STATUS_ESP32:
        engine.on_esp_status(payload)
    elif topic == "ws/" + C.WS_ACTION_DEMO_BOSS:
        return engine.on_demo_boss(now)
    elif topic == C.TOPIC_DEBUG_BOSS:
        return engine.on_debug_boss(payload, now)
    else:
        for p in C.PLANTS:
            if topic == C.TOPIC_SOIL.format(plant=p):
                try:
                    return engine.on_soil_raw(p, int(float(payload)), now)
                except ValueError:
                    log.warning("bad soil payload on %s: %r", topic, payload)
            elif topic == C.TOPIC_PAD.format(plant=p):
                engine.on_pad(p, payload)
    return []


async def main():
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    engine = GameEngine(creatures=battle.load_creatures())
    feed = api.Feed(engine, queue)
    client = mqtt_io.connect(loop, queue)

    async def ticker():
        while True:
            await asyncio.sleep(0.2)
            for cmd in engine.tick(time.monotonic()):
                client.publish(cmd.topic, cmd.payload)
            await feed.publish_if_changed()

    async def consumer():
        while True:
            topic, payload = await queue.get()
            for cmd in route(engine, topic, payload, time.monotonic()):
                client.publish(cmd.topic, cmd.payload)
            await feed.publish_if_changed()

    async with feed.serve():
        log.info("ws on %s:%s, mqtt %s:%s", C.WS_HOST, C.WS_PORT, C.MQTT_HOST, C.MQTT_PORT)
        await asyncio.gather(ticker(), consumer())


if __name__ == "__main__":
    asyncio.run(main())
