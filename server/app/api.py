# server/app/api.py: WebSocket game state feed and the boss override. Owner: Role 2 (server).
from __future__ import annotations

import json
from typing import Callable, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

import config


class Hub:
    """Keeps the set of connected browsers and pushes state to them."""

    def __init__(self):
        self.clients: Set[WebSocket] = set()

    async def broadcast(self, state: dict) -> None:
        if not self.clients:
            return
        text = json.dumps(state)
        for ws in list(self.clients):
            try:
                await ws.send_text(text)
            except Exception:
                self.clients.discard(ws)


def register(app: FastAPI, hub: Hub, get_state: Callable[[], dict], force_boss: Callable[[str], bool]) -> None:
    @app.get("/api/state")
    def state():
        return get_state()

    @app.post("/api/debug/boss/{pot}")
    def boss(pot: str):
        pot = pot.upper()
        if pot not in ("A", "B"):
            raise HTTPException(404, "pot must be A or B")
        return {"started": force_boss(pot)}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        hub.clients.add(websocket)
        try:
            await websocket.send_text(json.dumps(get_state()))
            while True:
                await websocket.receive_text()      # ignore input; just detect disconnect
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            hub.clients.discard(websocket)

    if config.CLIENT_DIR.is_dir():
        @app.get("/", include_in_schema=False)
        def root():
            return RedirectResponse("/client/")
        app.mount("/client", StaticFiles(directory=str(config.CLIENT_DIR), html=True), name="client")
