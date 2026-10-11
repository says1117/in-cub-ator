"""WebSocket feed for the game client. Sends the full game state whenever it changes.

The message format is in protocol.py and PROJECT.md. `websockets` is imported only when the feed
runs, so the rest of the server (and its tests) can be imported without it."""
import logging
import time

import protocol

log = logging.getLogger("api")


class Feed:
    def __init__(self, engine, queue):
        self.engine = engine
        self.queue = queue  # client actions are passed on to main as (topic, payload)
        self.clients = set()
        self._last = None

    async def handler(self, ws):
        import websockets

        self.clients.add(ws)
        self.engine.set_manual(True, time.monotonic())
        try:
            await ws.send(protocol.encode(self.engine.snapshot(time.monotonic())))
            async for message in ws:
                self._on_client_message(message)
        except websockets.ConnectionClosed:
            pass   # a screen went away without saying goodbye: normal on a kiosk
        finally:
            self.clients.discard(ws)
            self.engine.set_manual(bool(self.clients), time.monotonic())

    def _on_client_message(self, message):
        parsed = protocol.parse_client_message(message)
        if parsed is not None:
            self.queue.put_nowait(parsed)

    def next_message(self, now: float):
        """The message to broadcast, or None when only clock-only keys changed since the last one."""
        snap = self.engine.snapshot(now)
        key = protocol.encode(protocol.stable(snap))
        if key == self._last:
            return None
        self._last = key
        return protocol.encode(snap)

    async def publish_if_changed(self, now: float = None):
        message = self.next_message(time.monotonic() if now is None else now)
        if message is not None and self.clients:
            import websockets

            websockets.broadcast(self.clients, message)

    def serve(self, host, port):
        import websockets

        return websockets.serve(self.handler, host, port)
