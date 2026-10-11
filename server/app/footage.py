"""On-demand OpenCV frames for the footage page; model assessment is not configured."""
import json
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

    def frame(self, plant):
        config = self.configs.get(plant, {'source': 0, 'crop': None})
        source = config['source']
        if source not in self.devices:
            self.devices[source] = CameraDevice(source, self.factory)
        return self.devices[source].request(plant, config.get('crop'))

    def status(self, plant):
        config = self.configs.get(plant, {'source': 0, 'crop': None})
        return {'plantId': plant, 'camera': 'live' if self.frame(plant) else 'unavailable',
                'view': 'cropped' if config.get('crop') else 'full_frame',
                'assessment': {'status': 'model_not_configured', 'condition': None,
                               'confidence': None, 'assessedAt': None}}

    def close(self):
        for device in self.devices.values():
            device.close()
