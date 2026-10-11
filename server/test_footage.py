"""Tests for the footage endpoint (footage.py) with a fake camera, so no OpenCV or webcam is needed.
Run: python -m unittest test_footage -v  (from the server folder)"""
import json
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import Mock

import footage


def fake_camera(works=True):
    capture = Mock()
    capture.isOpened.return_value = works
    image = Mock(shape=(480, 640, 3))
    image.__getitem__ = Mock(return_value=image)
    capture.read.return_value = (True, image)
    cv = Mock(IMWRITE_JPEG_QUALITY=1)
    jpeg = Mock()
    jpeg.tobytes.return_value = b"jpeg-frame"
    cv.imencode.return_value = (True, jpeg)
    return Mock(return_value=(capture, cv))


class FootageEndpointTests(unittest.TestCase):
    def start(self, factory):
        self.server = footage.serve("127.0.0.1", 0, footage.PlantFootage(configs={}, factory=factory))
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}/api/plants"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.footage.close()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=2) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers

    def test_frame_arrives_once_the_camera_is_running(self):
        self.start(fake_camera())
        until = time.monotonic() + 3
        while time.monotonic() < until:
            code, body, headers = self.get("/PLANT_001/footage/frame")
            if code == 200:
                break
            time.sleep(0.05)
        self.assertEqual((code, body), (200, b"jpeg-frame"))
        self.assertEqual(headers["Content-Type"], "image/jpeg")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")

    def test_no_camera_is_a_503_not_a_crash(self):
        self.start(fake_camera(works=False))
        code, _, headers = self.get("/PLANT_001/footage/frame")
        self.assertEqual(code, 503)
        self.assertEqual(headers["Retry-After"], "1")

    def test_status_says_the_model_is_not_configured(self):
        self.start(fake_camera(works=False))
        code, body, _ = self.get("/PLANT_002/footage")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["assessment"]["status"], "model_not_configured")

    def test_other_paths_are_404(self):
        self.start(fake_camera())
        self.assertEqual(self.get("/../etc/footage")[0], 404)
        self.assertEqual(self.get("/PLANT_001/water")[0], 404)
        self.assertEqual(self.get("/MADE_UP/footage/frame")[0], 404)


if __name__ == "__main__":
    unittest.main()
