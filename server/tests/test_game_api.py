import tempfile
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app import main
from app.game import config as C

class GameAPITests(unittest.TestCase):
    def test_game_feed_shares_encounter_rejects_replays_and_restores(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=create_engine(f'sqlite:///{directory}/plants.db',connect_args={'check_same_thread':False})
            sessions=sessionmaker(bind=engine)
            with patch.object(main,'engine',engine),patch.object(main,'SessionLocal',sessions),patch.object(main,'start_mqtt',return_value=Mock()):
                with TestClient(main.app) as client:
                    def badge_db():
                        with sessions() as db:
                            yield db
                    main.app.dependency_overrides[main.get_db] = badge_db
                    try:
                        self.assertEqual(client.get('/api/collection').json(), {"badges": []})
                    finally:
                        main.app.dependency_overrides.pop(main.get_db, None)
                    with client.websocket_connect('/ws/game',headers={'origin':'http://localhost:5173'}) as a:
                        self.assertTrue(a.receive_json()['state']['authoritative'])
                        runtime=main.app.state.game
                        a.send_json({'action':'exploring'})
                        while not runtime.explorers:
                            a.receive_json()
                        self.assertTrue(runtime.explorers)
                        a.send_json({'action':'stop_exploring'})
                        while runtime.explorers:
                            a.receive_json()
                        self.assertIsNone(runtime.random_encounter_at)
                        a.send_json({'action':'demo_boss','plant':'A'})
                        while True:
                            state=a.receive_json()['state']
                            if state['mode']=='boss': break
                        fight=state['boss']['encounterId']
                        with client.websocket_connect('/ws/game',headers={'origin':'http://localhost:5173'}) as b:
                            self.assertEqual(b.receive_json()['state']['boss']['encounterId'],fight)
                            # Advance the pure server clock to avoid a slow timed integration test.
                            runtime=main.app.state.game
                            runtime.engine.game=replace(runtime.engine.game,mode_until=0)
                            runtime.engine.tick(__import__('time').time())
                            runtime.engine.move_ready_at=0
                            runtime.engine.battle=replace(runtime.engine.battle,intent={'move':'attack','grade':'sure','chance':1,'heavy':False,'bluff':None},boss_next='attack')
                            runtime.save()
                            a.send_json({'action':'move','move':'guard','turn':0,'fight':fight})
                            while True:
                                state=a.receive_json()['state']
                                if state.get('battle',{}).get('turn')==1: break
                            self.assertEqual(state['battle']['last_move']['outcome'],'CRITICAL HIT')
                            a.send_json({'action':'move','move':'guard','turn':0,'fight':fight})
                            while True:
                                message=a.receive_json()
                                if message['type']=='action_rejected': break
                            self.assertEqual(client.get('/api/game').json()['battle']['turn'],1)
                with TestClient(main.app) as restarted:
                    restored=restarted.get('/api/game').json()
                    self.assertEqual(restored['battle']['id'],fight)
                    self.assertEqual(restored['battle']['turn'],1)
            engine.dispose()
