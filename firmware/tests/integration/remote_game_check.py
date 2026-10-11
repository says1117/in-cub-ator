"""firmware/tests/integration/remote_game_check.py: Read-only check that the game on the Jetson can be played from another computer over Wi-Fi. Owner: Role 1 (firmware).

It never publishes to MQTT and never sends a game action, so it cannot run a pump.

Checks, from this computer to the Jetson:
  1. each port answers: game page 8080, game state WebSocket 8765, MQTT broker 1883
  2. the game page loads over HTTP
  3. the live game state arrives over the WebSocket (as the browser receives it)
  4. the broker passes the cube's status and soil readings to this computer

Run with the server's Python (it has paho-mqtt and websockets):
  server/.venv/bin/python firmware/tests/integration/remote_game_check.py <jetson address>
"""
import asyncio
import json
import socket
import sys
import time
import urllib.request

PORTS = {"game page": 8080, "game state (WebSocket)": 8765, "MQTT broker": 1883}
results = []


def report(ok, what, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {what}" + (f": {detail}" if detail else ""))


def check_ports(host):
    print("1. Ports reachable over Wi-Fi")
    for name, port in PORTS.items():
        try:
            with socket.create_connection((host, port), timeout=3):
                report(True, f"{name} (port {port})")
        except OSError as err:
            report(False, f"{name} (port {port})", f"{err.__class__.__name__}: {err}")


def check_page(host):
    print("2. Game page")
    try:
        with urllib.request.urlopen(f"http://{host}:8080/", timeout=5) as resp:
            body = resp.read(4096).decode("utf-8", "replace").lower()
            report(resp.status == 200 and "<html" in body, "page loads", f"HTTP {resp.status}")
    except Exception as err:  # noqa: BLE001
        report(False, "page loads", str(err))


def check_state(host):
    print("3. Live game state over the WebSocket")
    try:
        import websockets
    except ImportError:
        report(False, "websockets library", "run with server/.venv/bin/python")
        return

    async def receive():
        async with websockets.connect(f"ws://{host}:8765", open_timeout=5) as ws:
            return json.loads(await asyncio.wait_for(ws.recv(), 5))

    try:
        snap = asyncio.run(receive())
    except Exception as err:  # noqa: BLE001
        report(False, "game state received", str(err))
        return
    report("mode" in snap, "game state received", f"mode {snap.get('mode')}, schema {snap.get('schema_version', 1)}")
    meters = snap.get("meters", {})
    print(f"     water A/B: {meters.get('water')}  cube quiet (stale): {meters.get('stale')}")
    if "pads" in snap:
        print(f"     pads: {{{', '.join(f'{p}: {v.get(chr(112) + 'lant_id') or v.get('status')}' for p, v in snap['pads'].items())}}}")
        print(f"     party: {[p['name'] for p in snap.get('summoned_plants', [])]}")


def check_broker(host):
    print("4. Cube messages through the Jetson's broker (listening only)")
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        report(False, "paho-mqtt library", "run with server/.venv/bin/python")
        return
    seen = {}

    def on_message(client, userdata, msg):
        seen.setdefault(msg.topic, msg.payload.decode("utf-8", "replace"))

    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                         client_id=f"remote-check-{int(time.time())}")
    client.on_message = on_message
    try:
        client.connect(host, 1883, keepalive=10)
    except OSError as err:
        report(False, "connected to the broker", str(err))
        return
    client.subscribe([("incube/status/esp32", 0), ("incube/soil/A", 0), ("incube/soil/B", 0),
                      ("incube/pad/A", 0), ("incube/pad/B", 0)])
    client.loop_start()
    deadline = time.time() + 8
    while time.time() < deadline and not {"incube/soil/A", "incube/status/esp32"} <= set(seen):
        time.sleep(0.2)
    client.loop_stop()
    client.disconnect()
    report(True, "connected to the broker")
    status = seen.get("incube/status/esp32")
    report(status == "online", "cube status", status or "nothing received (cube not connected to this broker?)")
    report("incube/soil/A" in seen, "soil readings arriving",
           f"A {seen.get('incube/soil/A')}, B {seen.get('incube/soil/B')}" if "incube/soil/A" in seen else "none in 8 s")
    for pad in ("A", "B"):
        if f"incube/pad/{pad}" in seen:
            print(f"     pad {pad}: {seen[f'incube/pad/{pad}'] or '(empty)'}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    host = sys.argv[1]
    print(f"Remote game check against {host} (read-only, sends nothing)\n")
    check_ports(host)
    check_page(host)
    check_state(host)
    check_broker(host)
    passed = sum(results)
    print(f"\n{passed} of {len(results)} checks passed.")
    if not all(results[:3]):
        print("If the ports fail: both computers must be on the same network, and that network must let\n"
              "devices reach each other (UCF networks usually do not). Use a phone hotspot or a travel router,\n"
              "and check the Jetson's firewall allows 8080, 8765 and 1883.")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
