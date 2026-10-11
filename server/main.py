"""Run the game server: python main.py

  --sim             made-up soil moisture for both plants instead of real sensors
  --offline         no Mosquitto needed: an in-process loopback replaces the broker (implies --sim)
                    With --sim or --offline the pump log is kept in memory only, unless --state is
                    given: a simulated run never touches the production pump log.
  --ws-port=N       serve the WebSocket on port N instead of config.WS_PORT
  --seed=N          fixed random seed for the game and the simulated soil (repeatable runs)
  --state=PATH      pump log / stats file (default: server/var/pump_log.json)
"""
import asyncio
import datetime
import logging
import math
import os
import random
import sys
import time

import api
import battle
import config as C
import mqtt_io
import persist
import protocol
from engine import GameEngine
from moisture_sim import MoistureSim

log = logging.getLogger("main")

HERE = os.path.dirname(os.path.abspath(__file__))


def route(engine: GameEngine, topic: str, payload: str, now: float) -> list:
    """One incoming message (MQTT or WebSocket) -> pump commands. Never raises: a bad message is
    logged and ignored, so nothing anyone publishes can stop the server."""
    try:
        return _route(engine, topic, payload, now)
    except Exception:
        log.exception("ignored message on %r: %r", topic, payload)
        return []


def _route(engine, topic, payload, now):
    if topic == C.TOPIC_STATUS_ESP32:
        engine.on_esp_status(payload, now)
    elif topic == protocol.MOVE_TOPIC:
        move, turn = protocol.parse_move(payload)
        return engine.on_player_move(move, now, turn)
    elif topic == protocol.DEMO_TOPIC:
        return engine.on_demo_boss(now)
    elif topic == C.TOPIC_DEBUG_BOSS:
        return engine.on_debug_boss(payload, now)
    else:
        for p in C.PLANTS:
            if topic == C.TOPIC_SOIL.format(plant=p):
                try:
                    value = float(payload)
                except (TypeError, ValueError):
                    value = float("nan")
                if not math.isfinite(value):
                    log.warning("bad soil payload on %s: %r", topic, payload)
                    return []
                return engine.on_soil_raw(p, int(value), now)
            elif topic == C.TOPIC_PAD.format(plant=p):
                engine.on_pad(p, payload)
    return []


def published(info) -> bool:
    """paho's publish() returns a message info with rc 0 (MQTT_ERR_SUCCESS) when queued; the
    loopback returns None and cannot fail."""
    return info is None or getattr(info, "rc", 0) == 0


def state_path_for(argv) -> str:
    """Where the pump log lives: --state=PATH, else the production file, except that a simulated
    run (--sim or --offline) keeps it in memory ("") so it can never touch the real log."""
    for arg in argv:
        if arg.startswith("--state="):
            return arg.split("=", 1)[1]
    if "--sim" in argv or "--offline" in argv:
        return ""
    return os.path.join(HERE, C.PUMP_LOG_FILE)


def save_state(engine: GameEngine, path: str, now: float, wall: float) -> bool:
    """Write the pump log if it changed. `dirty` is cleared only after a successful save, so a
    failed write is retried on the next tick and a pump that really happened is never forgotten.
    Returns False when the save failed."""
    if not engine.dirty:
        return True
    if not path:
        engine.dirty = False      # memory only
        return True
    try:
        persist.save(path, engine.persisted(now), wall)
    except OSError:
        return False
    engine.dirty = False
    return True


def _flag_value(name: str):
    for arg in sys.argv[1:]:
        if arg.startswith(name + "="):
            return arg.split("=", 1)[1]
    return None


async def main():
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    seed = _flag_value("--seed")
    rng = random.Random(int(seed)) if seed is not None else random.Random()
    engine = GameEngine(creatures=battle.load_creatures(), rng=rng)
    if _flag_value("--ws-port"):
        C.WS_PORT = int(_flag_value("--ws-port"))
    feed = api.Feed(engine, queue)
    offline = "--offline" in sys.argv
    if offline:
        client = mqtt_io.LoopbackBus(loop, queue)
        log.info("OFFLINE: no broker, messages loop back inside the server")
    else:
        client = mqtt_io.connect(loop, queue)

    simulated = offline or "--sim" in sys.argv
    state_path = state_path_for(sys.argv[1:])
    if state_path:
        data = persist.load(state_path, time.time())
        engine.restore(data, time.monotonic())
        log.info("pump log %s: %s", state_path, data["status"])
        engine.dirty = data["status"] == persist.CORRUPT   # rewrite a damaged file at once
    else:
        log.info("pump log kept in memory only")

    sim = None
    if simulated:
        # TEMPORARY: made-up moisture for both plants instead of real sensors
        sim = {p: MoistureSim(rng=random.Random(rng.random()), start=rng.uniform(*C.SIM_START_PCT[p]))
               for p in C.PLANTS}
        C.COOLDOWN_SECONDS = C.SIM_COOLDOWN_SECONDS
        C.REWARD_MIN_GAP_SECONDS = C.SIM_COOLDOWN_SECONDS
        log.info("SIMULATED moisture is on, cooldown %.0fs", C.COOLDOWN_SECONDS)

    def send(cmd, now):
        # QoS 0, not retained: a pump command is never stored or re-sent later by the broker.
        info = client.publish(cmd.topic, cmd.payload, qos=0, retain=False)
        if not published(info):
            engine.pump_failed(cmd, now)
            return
        for p in (sim or {}):
            if cmd.topic == C.TOPIC_CMD_PUMP.format(plant=p):
                sim[p].watered(int(cmd.payload))

    save_failing = [False]

    def save_if_dirty(now):
        ok = save_state(engine, state_path, now, time.time())
        if not ok and not save_failing[0]:
            log.error("could not save the pump log to %s, retrying every tick", state_path)
        elif ok and save_failing[0]:
            log.info("pump log saved again")
        save_failing[0] = not ok

    async def ticker():
        while True:
            await asyncio.sleep(0.2)
            try:
                now = time.monotonic()
                engine.set_manual(bool(feed.clients), now)
                engine.set_today(datetime.date.today().isoformat())
                for cmd in engine.tick(now):
                    send(cmd, now)
                save_if_dirty(now)
                await feed.publish_if_changed(now)
            except Exception:
                log.exception("tick failed")

    async def consumer():
        while True:
            topic, payload = await queue.get()
            try:
                now = time.monotonic()
                for cmd in route(engine, topic, payload, now):
                    send(cmd, now)
                save_if_dirty(now)
                await feed.publish_if_changed(now)
            except Exception:
                log.exception("message on %r failed", topic)

    async def moisture_simulator():
        client.publish(C.TOPIC_STATUS_ESP32, "online")
        while True:
            for p in C.PLANTS:
                client.publish(C.TOPIC_SOIL.format(plant=p), str(sim[p].raw()))
            await asyncio.sleep(1.0)
            for p in C.PLANTS:
                sim[p].step(1.0)

    async with feed.serve(C.WS_HOST, C.WS_PORT):
        log.info("ws on %s:%s, mqtt %s:%s", C.WS_HOST, C.WS_PORT, C.MQTT_HOST, C.MQTT_PORT)
        tasks = [ticker(), consumer()]
        if sim:
            tasks.append(moisture_simulator())
        await asyncio.gather(*tasks)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    asyncio.run(main())
