# server/app/vision.py: Camera / vision input. Owner: Role 2 (server).
"""Optional camera. Measures how bright the scene is and reports it as "sunlight" (0-100).

Needs OpenCV. On the Jetson use the JetPack build (apt install python3-opencv).
If OpenCV or the camera is missing, everything keeps working and sunlight stays unknown.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Optional

import config

log = logging.getLogger("incube.vision")


def csi_pipeline(sensor_id: int = 0, width: int = 640, height: int = 360, fps: int = 15) -> str:
    """GStreamer pipeline for a CSI ribbon-cable camera (IMX219 etc.) on the Jetson."""
    return (f"nvarguscamerasrc sensor-id={sensor_id} ! "
            f"video/x-raw(memory:NVMM),width=1280,height=720,framerate={fps}/1 ! "
            f"nvvidconv ! video/x-raw,width={width},height={height},format=BGRx ! "
            "videoconvert ! video/x-raw,format=BGR ! appsink drop=1")


class Vision:
    def __init__(self, on_sunlight: Callable[[Optional[float]], None]):
        self._cb = on_sunlight
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if not config.VISION_ENABLED:
            return
        self._thread = threading.Thread(target=self._run, name="vision", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _open(self, cv2):
        cam = config.CAMERA
        if cam.lower() == "csi":
            return cv2.VideoCapture(csi_pipeline(), cv2.CAP_GSTREAMER)
        if cam.isdigit():
            return cv2.VideoCapture(int(cam))
        return cv2.VideoCapture(cam, cv2.CAP_GSTREAMER)   # custom pipeline string

    def _run(self) -> None:
        try:
            import cv2  # type: ignore
        except ImportError:
            log.warning("OpenCV not installed; vision disabled")
            return
        while not self._stop.is_set():
            cap = self._open(cv2)
            if not cap.isOpened():
                log.warning("camera %r would not open; retrying in 15s", config.CAMERA)
                self._cb(None)
                self._stop.wait(15)
                continue
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    break
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                self._cb(round(float(gray.mean()) / 255.0 * 100.0, 1))
                self._stop.wait(config.VISION_INTERVAL)
            cap.release()
            time.sleep(1)
