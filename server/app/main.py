
# app/main.py

from .footage import PlantFootage
from fastapi.responses import Response
from .mqtt_client import start_mqtt
from .game.runtime import GameRuntime
from .game import battle as battle_rules
import asyncio
import time
import os
from contextlib import suppress
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    Depends
)

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import Base, engine, SessionLocal, get_db
from .models import Plant, WateringReward, WateringCooldown
from .plants import plants as initial_plants
from .progression import update_moisture, expire_cooldowns, FULL_DURATION


def allowed_origins():
    return {"http://localhost:5173", "http://127.0.0.1:5173", *filter(None, os.getenv("INCUBE_ALLOWED_ORIGINS", "").split(","))}


clients = set()
plant_lock = asyncio.Lock()


def plant_to_dict(plant):
    with SessionLocal() as db:
        cooldown = db.get(WateringCooldown, plant.plantId)
        until = cooldown.until if cooldown else None
    runtime = getattr(app.state, "game", None)
    slot = next((slot for slot, pid in runtime.slot_ids.items() if pid == plant.plantId), None) if runtime else None
    if slot:
        fighter = runtime.engine.fighter(slot, level=plant.level)
    else:
        slot = "B" if "monstera" in plant.species.lower() else "A"
        fighter = battle_rules.levelled(battle_rules.plant_fighter(slot), plant.level)
    return {
        "combatStats": {"maxHp": fighter.hp, "attackDamage": fighter.atk, "shield": fighter.shield},
        "plantId": plant.plantId,
        "nfcTagId": plant.nfcTagId,
        "species": plant.species,
        "soilMoisture": plant.soilMoisture,
        "lightIntensity": plant.lightIntensity,
        "co2": plant.co2,
        "level": plant.level,
        "hp": plant.hp,
        "wateringAvailableAt": until
    }


def get_all_plants(db):
    return [
        plant_to_dict(plant)
        for plant in db.query(Plant).all()
    ]



@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.footage = PlantFootage()
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        if db.query(Plant).count() == 0:
            for data in initial_plants:
                db.add(Plant(**data))
            db.commit()

    with SessionLocal() as db:
        expire_cooldowns(db)
        db.flush()
        # Existing full plants get a hold without receiving an extra level.
        for plant in db.query(Plant).filter(Plant.soilMoisture >= 100).all():
            if db.get(WateringCooldown, plant.plantId) is None:
                db.add(WateringCooldown(plantId=plant.plantId, until=time.time() + FULL_DURATION))
        db.commit()
    cooldown_task = asyncio.create_task(cooldown_worker())

    # Start MQTT after database initialization
    loop = asyncio.get_running_loop()
    mqtt_client = start_mqtt(loop, broadcast_plants, game_callback=lambda event: app.state.game.telemetry(event))
    async def game_water(plant_id, battle_id):
        return await apply_simulated_watering(plant_id, battle_id, 20.0, WateringReward, "battleId")
    app.state.game = GameRuntime(SessionLocal, game_water, broadcast_plants, mqtt_client)
    game_task = asyncio.create_task(app.state.game.run())

    try:
        yield
    finally:
        await asyncio.to_thread(app.state.footage.close)
        game_task.cancel()
        with suppress(asyncio.CancelledError):
            await game_task
        cooldown_task.cancel()
        with suppress(asyncio.CancelledError):
            await cooldown_task
        mqtt_client.loop_stop()
        mqtt_client.disconnect()



app = FastAPI(
    title="Plant Care API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins()),
    allow_credentials=False,
    allow_methods=["GET", "PATCH", "POST"],
    allow_headers=["*"]
)


class PlantUpdate(BaseModel):
    soilMoisture: float | None = Field(default=None, ge=0, le=100)
    lightIntensity: float | None = Field(default=None, ge=0)
    co2: float | None = Field(default=None, ge=0)
    level: int | None = Field(default=None, ge=1)
    hp: int | None = Field(default=None, ge=0, le=100)


async def cooldown_worker():
    while True:
        await asyncio.sleep(0.1)
        async with plant_lock:
            with SessionLocal() as db:
                changed = expire_cooldowns(db)
                db.commit()
            if changed:
                await broadcast_plants()


async def broadcast_plants():
    with SessionLocal() as db:
        data = get_all_plants(db)

    message = {
        "type": "plants_updated",
        "plants": data
    }

    for client in list(clients):
        try:
            await client.send_json(message)
        except Exception:
            clients.discard(client)


@app.get("/")
def home():
    return {
        "message": "Plant Care backend is running!"
    }


@app.get("/api/plants")
def get_plants(db: Session = Depends(get_db)):
    return get_all_plants(db)


@app.get("/api/plants/{plant_id}")
def get_plant(
    plant_id: str,
    db: Session = Depends(get_db)
):
    plant = db.get(Plant, plant_id)

    if not plant:
        raise HTTPException(
            status_code=404,
            detail="Plant not found"
        )

    return plant_to_dict(plant)


@app.patch("/api/plants/{plant_id}")
async def update_plant(
    plant_id: str,
    update: PlantUpdate
):
    changes = update.model_dump(
        exclude_unset=True,
        exclude_none=True
    )

    if not changes:
        raise HTTPException(
            status_code=400,
            detail="No fields provided"
        )

    async with plant_lock:
        with SessionLocal() as db:
            plant = db.get(Plant, plant_id)

            if not plant:
                raise HTTPException(
                    status_code=404,
                    detail="Plant not found"
                )

            moisture = changes.pop("soilMoisture", None)
            for key, value in changes.items():
                setattr(plant, key, value)
            if moisture is not None:
                update_moisture(plant, moisture, db)

            db.commit()
            db.refresh(plant)

            result = plant_to_dict(plant)

        await broadcast_plants()

    return result


class VictoryRewardRequest(BaseModel):
    battleId: str = Field(min_length=1, max_length=128)


class ManualWateringRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=128)


async def apply_simulated_watering(plant_id, request_id, increase, model, id_field):
    """Persist a demo moisture reading and broadcast it; no relay commands."""
    async with plant_lock:
        with SessionLocal() as db:
            plant = db.get(Plant, plant_id)
            if plant is None:
                raise HTTPException(status_code=404, detail="Plant not found")

            expire_cooldowns(db)
            db.flush()
            receipt = db.get(model, request_id)
            duplicate = receipt is not None
            if receipt and receipt.plantId != plant_id:
                raise HTTPException(status_code=409, detail="Request already watered another plant")
            if receipt is None:
                before = plant.soilMoisture
                update_moisture(plant, min(100.0, before + increase), db)
                receipt = model(**{
                    id_field: request_id, "plantId": plant_id,
                    "moistureBefore": before, "moistureAfter": plant.soilMoisture
                })
                db.add(receipt)
                db.commit()
                db.refresh(receipt)

            db.commit()
            result = {
                "plantId": plant_id, id_field: request_id,
                "simulated": True, "alreadyRewarded": duplicate,
                "previousSoilMoisture": receipt.moistureBefore,
                "soilMoisture": receipt.moistureAfter,
                "increase": receipt.moistureAfter - receipt.moistureBefore,
                "level": plant.level,
                "wateringBlocked": plant.soilMoisture >= 100
            }

        # Re-broadcast duplicates too, allowing clients to recover a missed message.
        await broadcast_plants()
    return result


@app.post("/api/plants/{plant_id}/watering-reward")
async def award_simulated_watering(plant_id: str, request: VictoryRewardRequest):
    if not app.state.game.simulation:
        raise HTTPException(409, "Hardware victory rewards are issued by the game engine")
    return await apply_simulated_watering(
        plant_id, request.battleId, 20.0, WateringReward, "battleId"
    )


@app.post("/api/plants/{plant_id}/water")
async def manually_water_plant(plant_id: str, request: ManualWateringRequest):
    with SessionLocal() as db:
        if db.get(Plant, plant_id) is None:
            raise HTTPException(404, "Plant not found")
    raise HTTPException(403, "Manual watering is disabled. Defeat a boss to earn water.")


@app.websocket("/ws/plants")
async def plant_websocket(websocket: WebSocket):
    # Restrict browser origins during local development.
    if websocket.headers.get("origin") not in allowed_origins():
        await websocket.close(code=1008)
        return

    await websocket.accept()
    clients.add(websocket)

    try:
        with SessionLocal() as db:
            data = get_all_plants(db)

        await websocket.send_json({
            "type": "plants_updated",
            "plants": data
        })

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        pass

    finally:
        clients.discard(websocket)


@app.get("/api/game")
async def game_snapshot():
    return app.state.game.snapshot()


@app.websocket("/ws/game")
async def game_websocket(websocket: WebSocket):
    if websocket.headers.get("origin") not in allowed_origins():
        await websocket.close(code=1008)
        return
    await websocket.accept()
    runtime = app.state.game
    runtime.clients.add(websocket)
    try:
        await websocket.send_json({"type": "game_updated", "state": runtime.snapshot()})
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                await websocket.send_json({"type": "action_rejected", "reason": "Invalid JSON"})
                continue
            if not isinstance(data, dict):
                continue
            if data.get("action") in ("exploring", "stop_exploring"):
                runtime.exploring(websocket, data["action"] == "exploring")
                continue
            accepted = await runtime.action(data.get("action"), data.get("move"),
                                            data.get("turn"), data.get("fight"), data.get("plant"))
            if not accepted:
                await websocket.send_json({"type": "action_rejected", "reason": "Action is stale or unavailable"})
    except WebSocketDisconnect:
        pass
    finally:
        runtime.clients.discard(websocket)
        runtime.explorers.pop(websocket, None)


@app.get("/api/plants/{plant_id}/footage/frame")
async def plant_footage_frame(plant_id: str, db: Session = Depends(get_db)):
    if db.get(Plant, plant_id) is None:
        raise HTTPException(404, "Plant not found")
    frame = app.state.footage.frame(plant_id)
    if frame is None:
        return Response(status_code=503, headers={"Cache-Control": "no-store", "Retry-After": "1"})
    return Response(frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/plants/{plant_id}/footage")
async def plant_footage_status(plant_id: str, db: Session = Depends(get_db)):
    if db.get(Plant, plant_id) is None:
        raise HTTPException(404, "Plant not found")
    return app.state.footage.status(plant_id)


@app.get("/api/collection")
def badge_collection(db: Session = Depends(get_db)):
    from .badges import collection
    return {"badges": collection(db)}
