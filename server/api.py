"""WebSocket feed for the game client. Sends the full game state on every change."""
import json

import websockets

import config as C


class Feed:
    def __init__(self, engine, queue):
        self.engine = engine
        self.queue = queue  # client actions are passed on to main as ("ws/<action>", "")
        self.clients = set()
        self._last = None

    async def handler(self, ws):
        self.clients.add(ws)
        try:
            await ws.send(json.dumps(self.engine.snapshot()))
            async for message in ws:
                self._on_client_message(message)
        finally:
            self.clients.discard(ws)

    def _on_client_message(self, message):
        try:
            data = json.loads(message)
            action = data.get("action")
        except (ValueError, AttributeError):
            return
        if action == C.WS_ACTION_DEMO_BOSS:
            self.queue.put_nowait(("ws/" + action, ""))
        elif action == C.WS_ACTION_MOVE:
            self.queue.put_nowait(("ws/" + action, str(data.get("move", ""))))

    async def publish_if_changed(self):
        msg = json.dumps(self.engine.snapshot(), sort_keys=True)
        if msg == self._last:
            return
        self._last = msg
        websockets.broadcast(self.clients, msg)

    def serve(self):
        return websockets.serve(self.handler, C.WS_HOST, C.WS_PORT)
