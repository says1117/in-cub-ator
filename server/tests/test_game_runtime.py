import random
import tempfile
import time
import unittest
from dataclasses import replace
from unittest.mock import AsyncMock, Mock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import Plant
from app.game.runtime import GameRuntime, IntegratedEngine
from app.game import battle as B, config as C, state_machine as S

class RulesTests(unittest.TestCase):
    def test_charge_level_and_laser(self):
        e=IntegratedEngine(rng=random.Random(3)); e.levels['A']=4
        self.assertEqual(e.fighter('A').atk,C.PLANT_FIGHTERS['A']['atk']+3)
        e.last_seen=100; e.on_demo_boss(100,'A'); e.tick(106)
        b=replace(e.battle,attack_count=2,intent={'move':'special','grade':'sure','chance':1,'heavy':False,'bluff':None,'laser':True},boss_next='special')
        hit=B.resolve_turn(b,'guard','special')
        self.assertEqual(hit.last_move['took'],11); self.assertEqual(hit.attack_count,3)
        b=replace(e.battle,charge=0,intent=None)
        b=B.resolve_turn(b,'guard','attack'); self.assertFalse(B.skill_ready(b))
        b=B.resolve_turn(b,'special','guard'); self.assertTrue(B.skill_ready(b)); self.assertEqual(b.blooms,2)

class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.db=create_engine(f'sqlite:///{self.tmp.name}/test.db')
        Base.metadata.create_all(self.db); self.sessions=sessionmaker(bind=self.db)
        with self.sessions() as db:
            for i in (1,2):
                db.add(Plant(plantId=f'PLANT_00{i}',nfcTagId=f'T{i}',species='Cast Iron' if i==1 else 'Monstera',soilMoisture=70,lightIntensity=1000,co2=400,level=i,hp=100))
            db.commit()
        self.water=AsyncMock(return_value={'increase':20,'soilMoisture':50}); self.broadcast=AsyncMock()
        self.rt=GameRuntime(self.sessions,self.water,self.broadcast,simulation=True)
        self.ws=Mock(send_json=AsyncMock()); self.rt.clients.add(self.ws)
    async def asyncTearDown(self):
        self.db.dispose(); self.tmp.cleanup()
    def moisture(self,a,b):
        with self.sessions() as db:
            db.get(Plant,'PLANT_001').soilMoisture=a; db.get(Plant,'PLANT_002').soilMoisture=b; db.commit()
    async def test_random_encounter_requires_walking_and_respects_cooldowns(self):
        now = time.time()
        self.rt.random_encounter(now)
        self.assertIsNone(self.rt.random_encounter_at)
        self.rt.explorers[self.ws] = now
        self.rt.random_encounter(now)
        deadline = self.rt.random_encounter_at
        self.assertGreaterEqual(deadline - now, 20)
        self.assertLessEqual(deadline - now, 45)
        self.rt.random_encounter(now + 7)  # expired presence, e.g. disconnected browser
        self.assertIsNone(self.rt.random_encounter_at)
        self.rt.explorers[self.ws] = now
        self.rt.random_encounter_at = now
        self.rt.engine.game = replace(self.rt.engine.game, quiet_until=now + 20)
        self.rt.random_encounter(now)
        self.assertEqual(self.rt.engine.game.mode, S.WALKING)
        self.rt.engine.game = replace(self.rt.engine.game, quiet_until=0,
                                      cooldown_until={'A': now + 60, 'B': now + 60})
        self.rt.random_encounter_at = now
        self.rt.random_encounter(now)
        self.assertEqual(self.rt.engine.game.mode, S.WALKING)
        self.rt.engine.game = replace(self.rt.engine.game, cooldown_until={'A': 0, 'B': 0})
        self.rt.random_encounter_at = now
        self.rt.random_encounter(now)
        e = self.rt.engine
        self.assertEqual(e.game.mode, S.BOSS)
        self.assertEqual(e.game.source, 'random')
        self.assertEqual(e.boss_kind, 'chomper')
        first_id = e.encounter_id
        # Healthy moisture does not dismiss a random encounter.
        e._set(S.on_soil(e.game, e.game.boss_plant, 80, now + 1))
        self.assertEqual(e.game.mode, S.BOSS)
        e.tick(now + 6)
        e._finish_battle(True, now + 7)
        await self.rt.drain_reward()
        self.water.assert_awaited_once()
        e.last_seen = now + 80
        e.tick(now + 80)
        self.rt.explorers[self.ws] = now + 80
        self.rt.random_encounter_at = now + 80
        self.rt.random_encounter(now + 80)
        self.assertEqual(e.boss_kind, 'sporelings')
        self.assertNotEqual(e.encounter_id, first_id)
        second_id = e.encounter_id
        self.rt.random_encounter_at = now + 80
        self.rt.random_encounter(now + 80)
        self.assertEqual(e.encounter_id, second_id)  # never overlap active fights

    async def test_random_presence_stops_immediately_and_blocks_offline(self):
        self.rt.exploring(self.ws)
        self.rt.random_encounter_at = time.time()
        self.rt.exploring(self.ws, False)
        self.assertFalse(self.rt.explorers)
        self.assertIsNone(self.rt.random_encounter_at)
        self.rt.exploring(self.ws)
        self.rt.engine.game = replace(self.rt.engine.game, stale=True)
        self.rt.random_encounter_at = time.time()
        self.rt.random_encounter(time.time())
        self.assertEqual(self.rt.engine.game.mode, S.WALKING)

    async def test_spawn_cancel_and_restart(self):
        self.moisture(30,10); now=time.time()
        for i in range(5): await self.rt.step(now+i+1)
        self.assertEqual(self.rt.engine.game.mode,S.BOSS)
        await self.rt.step(now+11); battle=self.rt.engine.battle; self.assertIsNotNone(battle)
        restored=GameRuntime(self.sessions,self.water,self.broadcast,simulation=True)
        self.assertEqual(restored.engine.encounter_id,self.rt.engine.encounter_id); self.assertEqual(restored.engine.battle,battle)
        self.moisture(80,80)
        await self.rt.step(now+12)
        self.assertEqual(self.rt.engine.game.mode,S.WALKING); self.assertEqual(self.rt.engine.next_kind,0)
        self.assertEqual(self.rt.engine.result['outcome'],'dismissed'); self.assertIn(self.rt.engine.result['plant'],C.PLANTS)
    async def test_actions_reward_once_and_alternate(self):
        now=time.time(); await self.rt.action('demo_boss',plant='A'); await self.rt.step(now+6)
        e=self.rt.engine; e.move_ready_at=0
        e.battle=replace(e.battle,boss_hp=1,intent={'move':'attack','grade':'sure','chance':1,'heavy':False,'bluff':None},boss_next='attack')
        fight=e.encounter_id
        self.assertFalse(await self.rt.action('move','guard',0,'wrong'))
        self.assertTrue(await self.rt.action('move','guard',0,fight)); self.assertFalse(await self.rt.action('move','guard',0,fight))
        self.water.assert_awaited_once_with('PLANT_001',fight); self.assertTrue(e.result['simulated']); self.assertEqual(e.next_kind,1)
        restored=GameRuntime(self.sessions,self.water,self.broadcast,simulation=True); await restored.drain_reward(); self.water.assert_awaited_once()
        e.tick(now+14); e.on_demo_boss(now+15,'B'); self.assertEqual(e.boss_kind,'sporelings')
        e.on_esp_status('offline',now+16); e.on_demo_boss(now+17,'A'); self.assertEqual(e.boss_kind,'sporelings')
    async def test_hardware_stale_cancels_without_pump(self):
        rt=GameRuntime(self.sessions,self.water,self.broadcast,mqtt=Mock(),simulation=False); now=time.time()
        rt.engine.on_esp_status('online',now); rt.engine.on_demo_boss(now,'A'); await rt.step(now+C.ESP32_STALE_SECONDS+1)
        self.assertTrue(rt.engine.game.stale); self.assertEqual(rt.engine.game.mode,S.WALKING); rt.mqtt.publish.assert_not_called()
    async def test_pending_reward_retry_uses_same_receipt(self):
        e=self.rt.engine; e.pending_reward={'battleId':'receipt','plant':'A','ms':2000}; e.result={'fight':'receipt','outcome':'won','plant':'A'}; self.rt.save()
        restored=GameRuntime(self.sessions,self.water,self.broadcast,simulation=True); await restored.drain_reward()
        self.water.assert_awaited_once_with('PLANT_001','receipt'); self.assertIsNone(restored.engine.pending_reward)

    async def test_hardware_manual_receipt_gap_and_sensor_source(self):
        mqtt=Mock(); mqtt.publish.return_value.rc=0
        rt=GameRuntime(self.sessions,self.water,self.broadcast,mqtt=mqtt,simulation=False)
        rt.engine.last_seen=time.time()
        result=await rt.hardware_water('PLANT_001','manual')
        self.assertTrue(result['commandSent']); self.assertFalse(result['simulated'])
        self.assertEqual(result['increase'],0)
        mqtt.publish.assert_called_once_with('incube/cmd/pump/A','1000',qos=0,retain=False)
        duplicate=await rt.hardware_water('PLANT_001','manual')
        self.assertTrue(duplicate['alreadyRewarded']); self.assertEqual(mqtt.publish.call_count,1)
        blocked=await rt.hardware_water('PLANT_001','new-request')
        self.assertEqual(blocked['blocked'],'pump_resting'); self.assertEqual(mqtt.publish.call_count,1)
        with self.sessions() as db: self.assertEqual(db.get(Plant,'PLANT_001').soilMoisture,70)
        restored=GameRuntime(self.sessions,self.water,self.broadcast,mqtt=mqtt,simulation=False)
        self.assertTrue((await restored.hardware_water('PLANT_001','manual'))['alreadyRewarded'])
        self.assertEqual(mqtt.publish.call_count,1)

    async def test_hardware_victory_publish_failure_is_not_retried(self):
        mqtt=Mock(); mqtt.publish.side_effect=RuntimeError('offline')
        rt=GameRuntime(self.sessions,self.water,self.broadcast,mqtt=mqtt,simulation=False)
        rt.engine.last_seen=time.time()
        rt.engine.pending_reward={'battleId':'reward','plant':'A','ms':2000}
        rt.engine.result={'fight':'reward','outcome':'won','plant':'A'}
        await rt.drain_reward()
        self.assertEqual(rt.engine.result['blocked'],'publish_failed')
        self.assertIsNone(rt.engine.pending_reward)
        restored=GameRuntime(self.sessions,self.water,self.broadcast,mqtt=mqtt,simulation=False)
        await restored.drain_reward(); self.assertEqual(mqtt.publish.call_count,1)

    async def test_nfc_tag_swaps_fighter_skill(self):
        self.rt.telemetry({'type':'pad','slot':'B','uid':'04:D4:E5:F6'})
        await self.rt.step()
        self.assertEqual(self.rt.engine.fighter('B').name,'Mossling')
        self.assertEqual(self.rt.engine.fighter('B').skill,'photosynthesis')

    async def test_timeout_and_disconnected_autoplay(self):
        e=self.rt.engine; now=time.time()
        e.on_demo_boss(now,'A'); e.tick(now+6)
        e.move_ready_at=0; e.move_deadline=0
        await self.rt.step(now+7)
        self.assertEqual(e.battle.turn,1); self.assertTrue(e.battle.last_move['auto'])
        self.rt.clients.clear(); e.next_turn_at=0
        await self.rt.step(now+8)
        self.assertEqual(e.battle.turn,2); self.assertTrue(e.battle.last_move['auto'])
