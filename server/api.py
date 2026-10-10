"""WebSocket feed for the game client. Sends the full game state on every change."""
import json

import websockets

import config as C


class Feed:
    def __init__(self, engine):
        self.engine = engine
        self.clients = set()
        self._last = None

    async def handler(self, ws):
        self.clients.add(ws)
        try:
            await ws.send(json.dumps(self.engine.snapshot()))
            async for _ in ws:  # client sends nothing we need
                pass
        finally:
            self.clients.discard(ws)

    async def publish_if_changed(self):
        msg = json.dumps(self.engine.snapshot(), sort_keys=True)
        if msg == self._last:
            return
        self._last = msg
        websockets.broadcast(self.clients, msg)

    def serve(self):
        return websockets.serve(self.handler, C.WS_HOST, C.WS_PORT)
