
# app/main.py

from .mqtt_client import start_mqtt
import asyncio
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
from .models import Plant
from .plants import plants as initial_plants


clients = set()
plant_lock = asyncio.Lock()


def plant_to_dict(plant):
    return {
        "plantId": plant.plantId,
        "nfcTagId": plant.nfcTagId,
        "species": plant.species,
        "soilMoisture": plant.soilMoisture,
        "lightIntensity": plant.lightIntensity,
        "co2": plant.co2,
        "level": plant.level,
        "hp": plant.hp
    }


def get_all_plants(db):
    return [
        plant_to_dict(plant)
        for plant in db.query(Plant).all()
    ]



@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        if db.query(Plant).count() == 0:
            for data in initial_plants:
                db.add(Plant(**data))
            db.commit()

    # Start MQTT after database initialization
    loop = asyncio.get_running_loop()
    mqtt_client = start_mqtt(loop, broadcast_plants)

    try:
        yield
    finally:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()



app = FastAPI(
    title="Plant Care API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=False,
    allow_methods=["GET", "PATCH"],
    allow_headers=["*"]
)


class PlantUpdate(BaseModel):
    soilMoisture: float | None = Field(default=None, ge=0, le=100)
    lightIntensity: float | None = Field(default=None, ge=0)
    co2: float | None = Field(default=None, ge=0)
    level: int | None = Field(default=None, ge=1)
    hp: int | None = Field(default=None, ge=0, le=100)


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

            for key, value in changes.items():
                setattr(plant, key, value)

            db.commit()
            db.refresh(plant)

            result = plant_to_dict(plant)

        await broadcast_plants()

    return result


@app.websocket("/ws/plants")
async def plant_websocket(websocket: WebSocket):
    # Restrict browser origins during local development.
    allowed_origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    }

    if websocket.headers.get("origin") not in allowed_origins:
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
