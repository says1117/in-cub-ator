"""On-demand OpenCV frames for the footage page; model assessment is not configured.

From Okayuu's footage page (okayuu-branch, server/app/footage.py). The camera code is theirs; serve()
at the bottom is new: it answers the page's two requests on its own port, because this server has no
HTTP API. The camera opens only while someone has the footage page open, and a missing camera or
missing OpenCV only shows "Camera unavailable"; the game and the pumps never depend on it.
"""
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import math
import os
import threading
import time


def camera_configs():
    values = json.loads(os.getenv('INCUBE_CAMERA_SOURCES', '{}'))
    if not isinstance(values, dict):
        raise ValueError('INCUBE_CAMERA_SOURCES must be a JSON object')
    result = {}
    for plant, value in values.items():
        config = value if isinstance(value, dict) else {'source': value}
        source, crop = config.get('source', 0), config.get('crop')
        if isinstance(source, bool) or not isinstance(source, (int, str)):
            raise ValueError('Camera sources must be indices or camera URLs')
        if crop is not None:
            if (not isinstance(crop, list) or len(crop) != 4 or
                any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) for n in crop) or
                min(crop) < 0 or crop[2] <= 0 or crop[3] <= 0 or
                crop[0] + crop[2] > 1 or crop[1] + crop[3] > 1):
                raise ValueError('Camera crop must be normalized [x, y, width, height] inside the frame')
        result[plant] = {'source': source, 'crop': crop}
    return result


def open_camera(source):
    # Missing OpenCV never prevents plant care or battles from starting.
    import cv2
    camera = cv2.VideoCapture(source)
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    return camera, cv2


class CameraDevice:
    def __init__(self, source, factory=open_camera):
        self.source, self.factory = source, factory
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.views = {}
        self.thread = None

    def request(self, plant, crop):
        with self.lock:
            view = self.views.setdefault(plant, {'frame': None, 'at': 0, 'crop': crop, 'requested': 0})
            view['requested'] = time.monotonic()
            if self.thread is None:
                self.thread = threading.Thread(target=self.run, daemon=True)
                self.thread.start()
            available = view['frame'] is not None and time.monotonic() - view['at'] < 2
            frame = view['frame'] if available else None
        self.wake.set()
        return frame

    def clear(self):
        with self.lock:
            for view in self.views.values():
                view['frame'], view['at'] = None, 0

    def run(self):
        camera = None
        try:
            while not self.stop.is_set():
                with self.lock:
                    active = [(p, v['crop']) for p, v in self.views.items()
                              if time.monotonic() - v['requested'] < 5]
                if not active:
                    if camera is not None:
                        camera.release()
                        camera = None
                    self.clear()
                    self.wake.wait(0.5)
                    self.wake.clear()
                    continue
                try:
                    if camera is None:
                        camera, cv = self.factory(self.source)
                    if not camera.isOpened():
                        raise RuntimeError('Camera unavailable')
                    ok, image = camera.read()
                    if not ok or image is None:
                        raise RuntimeError('No camera frame')
                    for plant, crop in active:
                        frame = image
                        if crop:
                            h, w = image.shape[:2]
                            x, y, cw, ch = crop
                            frame = image[int(y*h):max(int(y*h)+1, int((y+ch)*h)),
                                          int(x*w):max(int(x*w)+1, int((x+cw)*w))]
                        ok, jpeg = cv.imencode('.jpg', frame, [cv.IMWRITE_JPEG_QUALITY, 80])
                        if not ok:
                            raise RuntimeError('Frame encoding failed')
                        with self.lock:
                            self.views[plant].update(frame=jpeg.tobytes(), at=time.monotonic())
                    self.stop.wait(0.125)
                except Exception:
                    self.clear()
                    if camera is not None:
                        camera.release()
                        camera = None
                    self.stop.wait(2)
        finally:
            if camera is not None:
                camera.release()
            self.clear()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=1)


class PlantFootage:
    def __init__(self, configs=None, factory=open_camera):
        self.configs = camera_configs() if configs is None else configs
        self.factory, self.devices = factory, {}
        self.lock = threading.Lock()   # two requests at once must not open the same camera twice

    def frame(self, plant):
        config = self.configs.get(plant, {'source': 0, 'crop': None})
        source = config['source']
        with self.lock:
            if source not in self.devices:
                self.devices[source] = CameraDevice(source, self.factory)
            device = self.devices[source]
        return device.request(plant, config.get('crop'))

    def status(self, plant):
        config = self.configs.get(plant, {'source': 0, 'crop': None})
        return {'plantId': plant, 'camera': 'live' if self.frame(plant) else 'unavailable',
                'view': 'cropped' if config.get('crop') else 'full_frame',
                'assessment': {'status': 'model_not_configured', 'condition': None,
                               'confidence': None, 'assessedAt': None}}

    def close(self):
        with self.lock:
            devices = list(self.devices.values())
        for device in devices:
            device.close()


# The game screen's two plants (client/src/state/plantFeed.js). Only these, plus any plant named in
# INCUBE_CAMERA_SOURCES, get a camera view, so made-up names cannot pile up views in memory.
PLANT_IDS = {'PLANT_001', 'PLANT_002'}
ROUTE = re.compile(r'^/api/plants/([A-Za-z0-9_-]{1,40})/footage(/frame)?$')


def make_handler(footage):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            match = ROUTE.match(self.path.split('?')[0])
            if not match:
                return self.reply(404, b'', 'text/plain')
            plant, want_frame = match.group(1), match.group(2)
            if plant not in PLANT_IDS and plant not in footage.configs:
                return self.reply(404, b'', 'text/plain')
            try:
                if not want_frame:
                    return self.reply(200, json.dumps(footage.status(plant)).encode(), 'application/json')
                frame = footage.frame(plant)
            except Exception:  # noqa: BLE001 - a camera problem is only ever "unavailable"
                frame = None
            if frame is None:
                return self.reply(503, b'', 'text/plain', {'Retry-After': '1'})
            self.reply(200, frame, 'image/jpeg')

        def reply(self, code, body, kind, extra=None):
            self.send_response(code)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            # The page is served from port 8080, so the browser needs permission to read from 8090.
            self.send_header('Access-Control-Allow-Origin', '*')
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass   # one request every 150 ms per camera would flood the server log

    return Handler


def serve(host, port, footage=None):
    """Start the footage endpoint in a background thread and return the HTTP server."""
    try:
        footage = footage or PlantFootage()
    except ValueError:
        footage = PlantFootage(configs={})   # a bad INCUBE_CAMERA_SOURCES falls back to camera 0
    server = ThreadingHTTPServer((host, port), make_handler(footage))
    server.daemon_threads = True
    server.footage = footage
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
