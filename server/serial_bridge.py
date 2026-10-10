"""Read soil values from the ESP32 over USB and publish them to the game server's broker.

Use this until Role 1's firmware publishes to MQTT by itself. It reads the lines that
firmware/tests/soil_print/soil_print.ino prints, for example:

    soil A: 2310 (1860 mV)  soil B: 1405 (1130 mV)

and publishes 2310 to incube/soil/A and 1405 to incube/soil/B.

Run with the ESP32 plugged in:   python3 serial_bridge.py
Pick a port yourself:            python3 serial_bridge.py --port /dev/cu.usbserial-0001
Test without the sensor:         python3 serial_bridge.py --file sample_soil_lines.txt
Test by typing lines:            python3 serial_bridge.py --file -
"""
import argparse
import glob
import re
import sys
import time

import paho.mqtt.client as mqtt

import config as C

LINE = re.compile(r"soil\s*A:\s*(\d+).*?soil\s*B:\s*(\d+)", re.IGNORECASE)
PORT_PATTERNS = ["/dev/cu.usbserial*", "/dev/cu.SLAB*", "/dev/cu.usbmodem*", "/dev/ttyUSB*", "/dev/ttyACM*"]
RAW_MAX = 4095  # the ESP32's ADC range


def parse_line(line):
    """Return (a, b) raw values from one printed line, or None if it isn't a soil line."""
    match = LINE.search(line)
    if not match:
        return None
    a, b = int(match.group(1)), int(match.group(2))
    if not (0 <= a <= RAW_MAX and 0 <= b <= RAW_MAX):
        return None
    return a, b


def find_port():
    for pattern in PORT_PATTERNS:
        ports = sorted(glob.glob(pattern))
        if ports:
            return ports[0]
    return None


def lines_from_file(path, delay):
    source = sys.stdin if path == "-" else open(path)
    for line in source:
        yield line
        time.sleep(delay)


def lines_from_serial(port, baud):
    import serial  # pip install pyserial, only needed when a real sensor is connected

    with serial.Serial(port, baud, timeout=2) as conn:
        print(f"reading {port} at {baud} baud")
        while True:
            raw = conn.readline()
            if raw:
                yield raw.decode(errors="replace")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port, found automatically if left out")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--file", help="read lines from this file, or - for typing them, instead of a serial port")
    ap.add_argument("--delay", type=float, default=0.5, help="seconds between lines when using --file")
    ap.add_argument("--host", default=C.MQTT_HOST)
    ap.add_argument("--port-mqtt", type=int, default=C.MQTT_PORT)
    args = ap.parse_args()

    if args.file:
        lines = lines_from_file(args.file, args.delay)
    else:
        port = args.port or find_port()
        if not port:
            sys.exit("no ESP32 found on USB. Plug it in, or pass --port, or test with --file")
        lines = lines_from_serial(port, args.baud)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.will_set(C.TOPIC_STATUS_ESP32, "offline", retain=True)
    client.connect(args.host, args.port_mqtt)
    client.loop_start()
    client.publish(C.TOPIC_STATUS_ESP32, "online", retain=True)

    sent = 0
    try:
        for line in lines:
            values = parse_line(line)
            if values is None:
                continue
            a, b = values
            client.publish(C.TOPIC_SOIL.format(plant="A"), str(a))
            client.publish(C.TOPIC_SOIL.format(plant="B"), str(b))
            sent += 1
            print(f"soil A {a}  soil B {b}")
    except KeyboardInterrupt:
        pass
    finally:
        client.publish(C.TOPIC_STATUS_ESP32, "offline", retain=True).wait_for_publish()
        client.loop_stop()
        print(f"stopped, {sent} readings sent")


if __name__ == "__main__":
    main()
