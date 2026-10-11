import json
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app import main
from app.footage import PlantFootage, camera_configs


class FootageTests(unittest.TestCase):
    def factory(self):
        class Frame:
            shape = (480, 640, 3)
            def __getitem__(self, key):
                crops.append(key)
                return self
        crops = []
        capture = Mock()
        capture.isOpened.return_value = True
        capture.read.return_value = (True, Frame())
        cv = Mock()
        cv.IMWRITE_JPEG_QUALITY = 1
        jpeg = Mock()
        jpeg.tobytes.return_value = b'jpeg-frame'
        cv.imencode.return_value = (True, jpeg)
        return Mock(return_value=(capture, cv)), capture, crops

    def wait_frame(self, footage, plant):
        until = time.monotonic() + 3
        while time.monotonic() < until:
            frame = footage.frame(plant)
            if frame: return frame
            time.sleep(0.02)
        self.fail('No frame received')

    def test_shared_capture_crops_and_model_remains_unassessed(self):
        factory, capture, crops = self.factory()
        footage = PlantFootage({'A': {'source': 0, 'crop': [0, 0, .5, 1]},
                               'B': {'source': 0, 'crop': [.5, 0, .5, 1]}}, factory)
        try:
            self.assertEqual(self.wait_frame(footage, 'A'), b'jpeg-frame')
            self.assertEqual(self.wait_frame(footage, 'B'), b'jpeg-frame')
            factory.assert_called_once_with(0)
            self.assertIn((slice(0, 480), slice(0, 320)), crops)
            self.assertIn((slice(0, 480), slice(320, 640)), crops)
            status = footage.status('A')
            self.assertEqual(status['camera'], 'live')
            self.assertEqual(status['assessment']['status'], 'model_not_configured')
            self.assertIsNone(status['assessment']['condition'])
            self.assertIsNone(status['assessment']['confidence'])
        finally: footage.close()
        capture.release.assert_called_once()

    def test_missing_opencv_retries_and_stalled_frames_expire(self):
        good, capture, _ = self.factory()
        factory = Mock(side_effect=[ImportError('OpenCV missing'), good.return_value])
        footage = PlantFootage({}, factory)
        try:
            self.assertIsNone(footage.frame('A'))
            self.assertEqual(self.wait_frame(footage, 'A'), b'jpeg-frame')
            device = footage.devices[0]
            with device.lock: device.views['A']['at'] = time.monotonic() - 5
            self.assertIsNone(footage.frame('A'))
        finally: footage.close()

    def test_broken_read_releases_device(self):
        factory, capture, _ = self.factory()
        capture.read.return_value = (False, None)
        footage = PlantFootage({}, factory)
        try:
            footage.frame('A')
            until = time.monotonic() + 1
            while not capture.release.called and time.monotonic() < until: time.sleep(.01)
            self.assertTrue(capture.release.called)
            self.assertEqual(footage.status('A')['camera'], 'unavailable')
        finally: footage.close()

    def test_config_rejects_invalid_crops(self):
        for crop in [[0,0,0,1], [0,0,2,1], [-1,0,1,1], [0,0,1], ['x',0,1,1]]:
            with patch.dict('os.environ', {'INCUBE_CAMERA_SOURCES': json.dumps({'A': {'source':0,'crop':crop}})}):
                with self.assertRaises(ValueError): camera_configs()

    def test_endpoints_handle_missing_camera_and_unknown_plant(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine(f'sqlite:///{directory}/plants.db', connect_args={'check_same_thread':False})
            sessions = sessionmaker(bind=engine)
            footage = Mock()
            footage.frame.return_value = b'jpeg-frame'
            footage.status.return_value = {'assessment': {'status':'model_not_configured','condition':None}}
            with patch.object(main, 'engine', engine), patch.object(main, 'SessionLocal', sessions), \
                 patch.object(main, 'start_mqtt', return_value=Mock()), patch.object(main, 'PlantFootage', return_value=footage):
                def db_session():
                    with sessions() as db: yield db
                main.app.dependency_overrides[main.get_db] = db_session
                try:
                    with TestClient(main.app) as client:
                        response = client.get('/api/plants/PLANT_001/footage/frame')
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.headers['content-type'], 'image/jpeg')
                        self.assertEqual(response.headers['cache-control'], 'no-store')
                        self.assertEqual(client.get('/api/plants/PLANT_001/footage').json()['assessment']['condition'], None)
                        footage.frame.return_value = None
                        self.assertEqual(client.get('/api/plants/PLANT_001/footage/frame').status_code, 503)
                        self.assertEqual(client.get('/api/plants/unknown/footage/frame').status_code, 404)
                        self.assertEqual(client.get('/api/plants/unknown/footage').status_code, 404)
                    footage.close.assert_called_once()
                finally: main.app.dependency_overrides.pop(main.get_db, None)
            engine.dispose()
