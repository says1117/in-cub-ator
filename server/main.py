"""Run the game server: python main.py"""
import asyncio
import logging
import sys
import time

import api
import battle
import config as C
import mqtt_io
from engine import GameEngine
from moisture_sim import MoistureSim

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

    sim = None
    if "--sim" in sys.argv:
        # TEMPORARY: made-up moisture for plant A instead of a real sensor
        sim = MoistureSim()
        C.COOLDOWN_SECONDS = C.SIM_COOLDOWN_SECONDS
        C.REWARD_MIN_GAP_SECONDS = C.SIM_COOLDOWN_SECONDS
        log.info("SIMULATED moisture is on, cooldown %.0fs", C.COOLDOWN_SECONDS)

    def send(cmd):
        client.publish(cmd.topic, cmd.payload)
        if sim and cmd.topic == C.TOPIC_CMD_PUMP.format(plant="A"):
            sim.watered(int(cmd.payload))

    async def ticker():
        while True:
            await asyncio.sleep(0.2)
            for cmd in engine.tick(time.monotonic()):
                send(cmd)
            await feed.publish_if_changed()

    async def consumer():
        while True:
            topic, payload = await queue.get()
            for cmd in route(engine, topic, payload, time.monotonic()):
                send(cmd)
            await feed.publish_if_changed()

    async def moisture_simulator():
        client.publish(C.TOPIC_STATUS_ESP32, "online")
        client.publish(C.TOPIC_SOIL.format(plant="B"), str(C.SOIL_RAW_WET))
        while True:
            client.publish(C.TOPIC_SOIL.format(plant="A"), str(sim.raw()))
            await asyncio.sleep(1.0)
            sim.step(1.0)

    async with feed.serve():
        log.info("ws on %s:%s, mqtt %s:%s", C.WS_HOST, C.WS_PORT, C.MQTT_HOST, C.MQTT_PORT)
        tasks = [ticker(), consumer()]
        if sim:
            tasks.append(moisture_simulator())
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
