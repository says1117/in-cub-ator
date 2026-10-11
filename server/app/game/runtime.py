"""Bridge the donor engine to the plant database, FastAPI and optional MQTT hardware."""
import asyncio
import json
import logging
import os
import random
import time
import uuid
from dataclasses import asdict, replace
from pathlib import Path

from . import battle as B, config as C, state_machine as S
from .engine import GameEngine
from .moisture_sim import MoistureSim
from ..models import GameCheckpoint, HardwareWatering, Plant, VictoryBadge
from ..badges import badge_to_dict, collection
from ..progression import update_moisture

BOSS_ORDER = ("chomper", "sporelings")
BOSS_IDS = {"chomper": "drought-chomper", "sporelings": "sporeling-trio"}


class IntegratedEngine(GameEngine):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.next_kind = 0
        self.encounter_id = None
        self.result = None
        self.levels = {p: 1 for p in C.PLANTS}
        self.names = {"A": "Cast Iron Plant", "B": "Monstera deliciosa"}
        self.pending_reward = None

    def _set(self, new):
        entering = new.boss_plant is not None and self.game.boss_plant is None
        if entering:
            self.encounter_id = str(uuid.uuid4())
            self.boss_kind = BOSS_ORDER[self.next_kind]
            self.result = None
            self.last_reward = None
        super()._set(new)

    def fighter(self, plant, level=None):
        stats = super().fighter(plant)
        level = self.levels.get(plant, 1) if level is None else level
        name = stats.name if self.pads.get(plant) in self.creatures else self.names.get(plant, stats.name)
        return replace(B.levelled(stats, level), name=name)

    def _start_battle(self, now):
        super()._start_battle(now)
        self.battle = replace(self.battle, extended=True)

    def tick(self, now):
        previous = self.battle.turn if self.battle else -1
        commands = super().tick(now)
        if self.battle and self.battle.turn > previous and self.battle.last_move:
            self.battle = replace(self.battle, last_move={**self.battle.last_move, "auto": True})
        return commands

    def _finish_battle(self, won, now):
        plant = self.game.boss_plant
        kind = self.boss_kind
        commands = super()._finish_battle(won, now)
        self.next_kind = (self.next_kind + 1) % len(BOSS_ORDER)
        blocked = None
        if won and not commands:
            blocked = "offline" if self.game.stale or self.last_seen is None else "soil_wet" if self.soil_pct[plant] >= C.SOIL_WET_THRESHOLD_PCT and self.game.source not in (C.SOURCE_DEMO, "random") else "pump_resting"
        self.result = {"fight": self.encounter_id, "outcome": "won" if won else "lost",
                       "plant": plant, "kind": kind, "water_ms": 0, "blocked": blocked}
        if commands:
            self.pending_reward = {"battleId": self.encounter_id, "plant": plant,
                                   "ms": int(commands[0].payload)}
        return commands

    def _battle_snapshot(self, b):
        data = super()._battle_snapshot(b)
        last = dict(b.last_move) if b.last_move else None
        if last:
            last.update(dealt=last.get("damage", 0), taken=last.get("took", 0))
        skill = B.skill_of(b.creature)
        data.update(creature_atk=b.creature.atk, creature_shield=b.creature.shield,
                    id=self.encounter_id, last_move=last, blooms=b.blooms,
                    over=B.winner(b) is not None, accepting_move=data["awaiting_move"],
                    autopilot=not self.manual, move_deadline_in_ms=int(max(0, self.move_deadline-time.time())*1000))
        if data["skill"]:
            data["skill"].update(ready_in=max(0, C.SKILL_CHARGE_NEED-b.charge),
                                 kind="heal" if skill.get("heal") else "shield" if skill.get("block") else "hit",
                                 power=round(b.creature.atk*skill.get("damage_factor", 0)),
                                 heal=skill.get("heal", 0)+(b.creature.level-1 if skill.get("heal") else 0))
        return data

    def snapshot(self):
        state = super().snapshot()
        state.update(result=self.result, demo_available=self.game.mode in (S.WALKING, S.COOLDOWN),
                     bossBreatherUntil=self.game.quiet_until, cooldownUntil=self.game.cooldown_until,
                     authoritative=True)
        for plant, fighter in state["fighters"].items():
            stats = self.fighter(plant)
            fighter.update(level=stats.level, maxHp=stats.hp, attackDamage=stats.atk, shield=stats.shield)
        state["meters"]["thirsty"] = {p: self.soil_pct[p] < 50 for p in C.PLANTS}
        if state["boss"]:
            kind = state["boss"]["kind"]
            state["boss"].update(id=BOSS_IDS[kind], encounterId=self.encounter_id)
        return state


class GameRuntime:
    def __init__(self, sessions, watering, broadcast, mqtt=None, simulation=None):
        self.sessions, self.watering, self.broadcast, self.mqtt = sessions, watering, broadcast, mqtt
        self.simulation = simulation if simulation is not None else os.getenv("INCUBE_HARDWARE", "0") != "1"
        self.drying = self.simulation and os.getenv("INCUBE_MOISTURE_SIM", "0") == "1"
        self.engine = IntegratedEngine(creatures=B.load_creatures(str(Path(__file__).with_name("creatures.json"))))
        self.clients = set()
        self.explorers = {}
        self.encounter_rng = random.Random()
        self.random_encounter_at = None
        self.events = asyncio.Queue()
        self.lock = asyncio.Lock()
        self.last_sample = 0
        self.slot_ids = {}
        self.sims = {}
        self._saved = None
        self.restore()
        self.seed()
        with self.sessions() as db:
            self.badges = collection(db)

    def seed(self):
        with self.sessions() as db:
            # Stable species slots, independent of query ordering and storage selection.
            rows = db.query(Plant).order_by(Plant.plantId).all()[:2]
            for slot, row in zip(C.PLANTS, rows):
                self.slot_ids[slot] = row.plantId
                self.engine.soil_pct[slot] = row.soilMoisture
                self.engine.game.last_pct[slot] = row.soilMoisture
                self.engine.levels[slot] = max(1, row.level)
                self.engine.names[slot] = row.species
                self.sims[slot] = MoistureSim(start=row.soilMoisture)
        if self.simulation:
            self.engine.last_seen = time.time()
            self.engine.game = replace(self.engine.game, stale=False)

    def telemetry(self, event):
        self.events.put_nowait(event)

    def checkpoint(self):
        e = self.engine
        return {"version": 1, "game": asdict(e.game), "battle": asdict(e.battle) if e.battle else None,
                **{key: getattr(e, key) for key in ("soil_pct", "pads", "last_reward_at", "last_reward", "next_turn_at", "health", "_last_tick", "move_ready_at", "move_deadline", "last_seen", "lost", "boss_kind", "next_kind", "encounter_id", "result", "levels", "names", "pending_reward")}}

    def save(self):
        payload = json.dumps(self.checkpoint(), allow_nan=False)
        if payload == self._saved:
            return
        with self.sessions() as db:
            row = db.get(GameCheckpoint, "game")
            if row is None:
                db.add(GameCheckpoint(key="game", payload=payload))
            else:
                row.payload = payload
            db.commit()
        self._saved = payload

    def restore(self):
        # JSON, never pickle: persisted state is data only.
        with self.sessions() as db:
            row = db.get(GameCheckpoint, "game")
            if not row:
                self.engine.last_reward_at = {p: 0.0 for p in C.PLANTS}
                return
            data = json.loads(row.payload)
        if data.get("version") != 1:
            raise RuntimeError("Unsupported game checkpoint version")
        e = self.engine
        e.game = S.Game(**data.pop("game"))
        battle = data.pop("battle")
        if battle:
            for key in ("creature", "boss"):
                battle[key] = B.Stats(**battle[key])
            for key in ("bench", "fallen"):
                battle[key] = tuple((p, B.Stats(**stats)) for p, stats in battle[key])
            battle["seen"] = tuple(battle["seen"])
            e.battle = B.Battle(**battle)
        for key, value in data.items():
            if key != "version":
                setattr(e, key, value)

    def exploring(self, client, active=True):
        if client in self.clients and active:
            self.explorers[client] = time.time()
        else:
            self.explorers.pop(client, None)
        if not self.explorers:
            self.random_encounter_at = None

    def random_encounter(self, now):
        e = self.engine
        self.explorers = {client: seen for client, seen in self.explorers.items()
                          if client in self.clients and now - seen < 6}
        walking = bool(self.explorers) and e.game.mode in (S.WALKING, S.COOLDOWN)
        if not walking or e.game.stale or not self.slot_ids or now < e.game.quiet_until:
            self.random_encounter_at = None
            return
        ready = [p for p in self.slot_ids if now >= e.game.cooldown_until[p]]
        if not ready:
            self.random_encounter_at = None
            return
        if self.random_encounter_at is None:
            self.random_encounter_at = now + self.encounter_rng.uniform(20, 45)
        elif now >= self.random_encounter_at:
            plant = self.encounter_rng.choice(ready)
            e.on_demo_boss(now, plant)
            if e.game.mode == S.BOSS:
                e.game = replace(e.game, source="random")
            self.random_encounter_at = None

    async def action(self, action, move=None, turn=None, fight=None, plant=None):
        async with self.lock:
            e, now = self.engine, time.time()
            e.manual = bool(self.clients)
            if action == "demo_boss":
                if plant is not None and plant not in self.slot_ids:
                    return False
                e.on_demo_boss(now, plant)
            elif action == "move":
                if not e.battle or fight != e.encounter_id or turn != e.battle.turn or move not in B.PLAYER_MOVES:
                    return False
                if move == "skill" and not B.skill_ready(e.battle):
                    return False
                if not e.manual or e.game.mode != S.BATTLE or now < e.move_ready_at:
                    return False
                before = e.battle.turn
                e.on_player_move(move, now)
                if e.battle.turn == before:
                    return False
            else:
                return False
            self.save()  # Persist pending rewards before applying them; retries use the same receipt.
            await self.drain_reward()
            await self.publish()
            return True

    async def drain_reward(self):
        e = self.engine
        # Independent of watering: a wet plant or unavailable relay still earns a badge.
        if e.result and e.result.get("outcome") == "won" and e.result.get("fight") and not e.result.get("badge"):
            with self.sessions() as db:
                row = db.get(VictoryBadge, e.result["fight"])
                if row is None:
                    number = (db.query(VictoryBadge.number).order_by(VictoryBadge.number.desc()).first() or (0,))[0] + 1
                    row = VictoryBadge(battleId=e.result["fight"], number=number,
                                       boss=e.result.get("kind") or e.boss_kind or "unknown",
                                       plantId=self.slot_ids.get(e.result["plant"], e.result["plant"]),
                                       earnedAt=time.time())
                    db.add(row)
                    db.commit()
                e.result["badge"] = badge_to_dict(row)
                self.badges = collection(db)
            self.save()
        pending = e.pending_reward
        if not pending:
            return
        slot = pending["plant"]
        plant_id = self.slot_ids.get(slot)
        if self.simulation:
            result = await self.watering(plant_id, pending["battleId"])
            if "level" in result:
                e.levels[slot] = max(1, result["level"])
            e.result.update(simulated=True, increase=result["increase"], soilMoisture=result["soilMoisture"],
                            blocked=None if result["increase"] else "soil_wet", water_ms=0)
            e.soil_pct[slot] = result["soilMoisture"]
            self.sims[slot].pct = result["soilMoisture"]
            self.sims[slot].soak = C.SIM_SOAK_SECONDS
        else:
            e._check_stale(time.time())
            with self.sessions() as db:
                row = db.get(Plant, plant_id)
                full = row is None or row.soilMoisture >= 100
            blocked = "soil_wet" if full else "offline" if e.game.stale else None
            if not blocked:
                # Never retry a physical relay command after restart (delivery may be uncertain).
                e.pending_reward = None
                e.result.update(blocked="publish_failed", water_ms=0)
                self.save()
                try:
                    info = self.mqtt.publish(C.TOPIC_CMD_PUMP.format(plant=slot), str(min(pending["ms"], C.PUMP_MAX_MS)), qos=0, retain=False)
                    blocked = None if info.rc == 0 else "publish_failed"
                except Exception:
                    logging.exception("Pump publish failed")
                    blocked = "publish_failed"
            e.result.update(simulated=False, blocked=blocked, water_ms=0 if blocked else pending["ms"])
        e.pending_reward = None
        self.save()

    async def hardware_water(self, plant_id, request_id):
        from fastapi import HTTPException
        async with self.lock:
            e, now = self.engine, time.time()
            e._check_stale(now)
            slot = next((p for p, pid in self.slot_ids.items() if pid == plant_id), None)
            with self.sessions() as db:
                plant = db.get(Plant, plant_id)
                if plant is None or slot is None:
                    raise HTTPException(404, "Plant not found")
                prior = db.get(HardwareWatering, request_id)
                if prior:
                    if prior.plantId != plant_id:
                        raise HTTPException(409, "Request already watered another plant")
                    return {**json.loads(prior.payload), "alreadyRewarded": True}
                blocked = "soil_wet" if plant.soilMoisture >= 100 else "offline" if e.game.stale or e.last_seen is None else "pump_resting" if now-e.last_reward_at[slot] < C.REWARD_MIN_GAP_SECONDS else None
                result = {"plantId": plant_id, "requestId": request_id, "simulated": False,
                          "previousSoilMoisture": plant.soilMoisture, "soilMoisture": plant.soilMoisture,
                          "increase": 0, "wateringBlocked": bool(blocked), "blocked": blocked,
                          "commandSent": False, "alreadyRewarded": False}
                # Persist an attempt before publish: an uncertain physical delivery is never retried.
                receipt = HardwareWatering(requestId=request_id, plantId=plant_id, payload=json.dumps(result))
                db.add(receipt); db.commit()
                if not blocked:
                    duration = min(C.PUMP_MAX_MS, max(0, int(os.getenv("INCUBE_MANUAL_PUMP_MS", "1000"))))
                    e.last_reward_at[slot] = now
                    self.save()
                    try:
                        info = self.mqtt.publish(C.TOPIC_CMD_PUMP.format(plant=slot), str(duration), qos=0, retain=False)
                        sent = info.rc == 0
                    except Exception:
                        logging.exception("Manual pump publish failed")
                        sent = False
                    result.update(commandSent=sent, wateringBlocked=not sent,
                                  blocked=None if sent else "publish_failed", pumpMs=duration)
                    receipt.payload=json.dumps(result); db.commit()
            return result

    async def step(self, now=None):
        async with self.lock:
            now = time.time() if now is None else now
            e = self.engine
            e.manual = bool(self.clients)
            previous_plant = e.game.boss_plant or (e.battle.plant if e.battle else None)
            # Refresh readings and fighter levels; counting dry readings happens separately.
            with self.sessions() as db:
                for slot, plant_id in self.slot_ids.items():
                    row = db.get(Plant, plant_id)
                    e.soil_pct[slot] = row.soilMoisture
                    e.levels[slot] = max(1, row.level)
                    e.names[slot] = row.species
                    if self.drying and now-self.last_sample >= 1:
                        sim = self.sims[slot]
                        if row.soilMoisture != sim.pct:
                            if row.soilMoisture > sim.pct:
                                sim.soak = C.SIM_SOAK_SECONDS
                                sim.rate = sim._pick_rate()
                            sim.pct = row.soilMoisture
                        update_moisture(row, sim.step(min(1, now-self.last_sample)), db)
                db.commit()
            while not self.events.empty():
                event = self.events.get_nowait()
                if event["type"] == "soil":
                    slot = event.get("slot") or next((p for p, pid in self.slot_ids.items() if pid == event.get("plantId")), None)
                    if slot:
                        e._heard_from_esp32(now)
                        # Use stored value so telemetry respects the full-moisture hold.
                        e._set(S.on_soil(e.game, slot, e.soil_pct[slot], now))
                elif event["type"] == "pad" and event.get("slot") in self.slot_ids:
                    e.on_pad(event["slot"], event["uid"])
                elif event["type"] == "status" and not self.simulation:
                    e.on_esp_status(event["status"], now)
                elif event["type"] == "demo":
                    e.on_demo_boss(now, event.get("slot"))
            if self.simulation and now-self.last_sample >= 1:
                e._heard_from_esp32(now)
                for slot in sorted(self.slot_ids, key=lambda p: e.soil_pct[p]):
                    e._set(S.on_soil(e.game, slot, e.soil_pct[slot], now))
                self.last_sample = now
                if self.drying:
                    await self.broadcast()
            previous_id = e.encounter_id
            e.tick(now)
            self.random_encounter(now)
            if e.result is None and previous_id and e.battle is None and e.game.mode == S.WALKING:
                e.result = {"fight": previous_id, "outcome": "dismissed", "plant": previous_plant,
                            "water_ms": 0, "blocked": None}
            self.save()
            await self.drain_reward()
            await self.publish()

    def snapshot(self):
        return {**self.engine.snapshot(), "badges": self.badges, "simulatedWatering": self.simulation}

    async def publish(self):
        state = self.snapshot()
        for ws in list(self.clients):
            try:
                await ws.send_json({"type": "game_updated", "state": state})
            except Exception:
                self.clients.discard(ws)

    async def run(self):
        while True:
            try:
                await self.step()
            except Exception:
                logging.exception("Game tick failed; pending rewards remain retryable")
                await asyncio.sleep(1)
            await asyncio.sleep(0.2)
