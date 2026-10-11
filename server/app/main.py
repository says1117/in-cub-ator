# server/app/main.py: Server entry point; wires MQTT, state machine and API together. Owner: Role 2 (server).
"""Run from the server/ folder:  python -m app.main"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

import config
from . import api, rewards
from .mqtt_client import Mqtt
from .state_machine import Game
from .vision import Vision

log = logging.getLogger("incube")


def build_app() -> FastAPI:
    game = Game(progress=rewards.load_progress(config.PROGRESS_FILE))
    hub = api.Hub()
    t0 = time.monotonic()
    now = lambda: time.monotonic() - t0   # noqa: E731

    def handle_message(topic: str, payload: str) -> None:
        """Runs on the paho thread; hop onto the event loop before touching the game."""
        loop.call_soon_threadsafe(apply_message, topic, payload)

    def apply_message(topic: str, payload: str) -> None:
        parts = topic.split("/")
        try:
            if parts[1] == "pad" and parts[2] in game.pots:
                game.on_pad(parts[2], payload, now())
            elif parts[1] == "soil" and parts[2] in game.pots:
                game.on_soil(parts[2], int(float(payload)), now())
            elif parts[1] == "status":
                game.on_esp32(payload, now())
            elif parts[1] == "debug" and parts[2] == "boss":
                pot = (payload.strip().upper() or "A")[:1]
                if pot in game.pots:
                    game.force_boss(pot, now())
        except (ValueError, IndexError):
            log.warning("ignoring bad payload %r on %s", payload, topic)

    mqtt = Mqtt(handle_message)
    vision = Vision(game.on_sunlight)

    def send(cmds):
        for cmd in cmds:
            if cmd[0] == "pump":
                mqtt.publish(f"incube/cmd/pump/{cmd[1]}", cmd[2])
            elif cmd[0] == "light":
                mqtt.publish("incube/cmd/light", cmd[1])

    async def loop_task():
        last = now()
        while True:
            await asyncio.sleep(config.TICK_SECONDS)
            t = now()
            send(game.tick(t, t - last))
            send(game.maybe_auto_light(t))
            last = t
            if game.progress_dirty:
                game.progress_dirty = False
                rewards.save_progress(config.PROGRESS_FILE, game.xp)
            await hub.broadcast(game.snapshot(t))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        global loop
        loop = asyncio.get_running_loop()
        mqtt.start()
        vision.start()
        task = asyncio.create_task(loop_task())
        yield
        task.cancel()
        vision.stop()
        mqtt.stop()

    app = FastAPI(title="In-cube-ator", lifespan=lifespan)
    api.register(app, hub, lambda: game.snapshot(now()), lambda pot: game.force_boss(pot, now()))
    return app


loop: asyncio.AbstractEventLoop


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    uvicorn.run(build_app(), host=config.HTTP_HOST, port=config.HTTP_PORT, log_level="info")


if __name__ == "__main__":
    main()
