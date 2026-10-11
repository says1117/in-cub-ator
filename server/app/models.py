
# app/models.py

from sqlalchemy import String, Integer, Float
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Plant(Base):
    __tablename__ = "plants"

    plantId: Mapped[str] = mapped_column(
        String,
        primary_key=True
    )

    nfcTagId: Mapped[str] = mapped_column(
        String,
        unique=True
    )

    species: Mapped[str] = mapped_column(String)

    soilMoisture: Mapped[float] = mapped_column(Float)

    lightIntensity: Mapped[float] = mapped_column(Float)

    co2: Mapped[float] = mapped_column(Float)

    level: Mapped[int] = mapped_column(Integer)

    hp: Mapped[int] = mapped_column(Integer)


class WateringReward(Base):
    """Persistent receipt prevents a retried victory from watering twice."""
    __tablename__ = "watering_rewards"

    battleId: Mapped[str] = mapped_column(String, primary_key=True)
    plantId: Mapped[str] = mapped_column(String)
    moistureBefore: Mapped[float] = mapped_column(Float)
    moistureAfter: Mapped[float] = mapped_column(Float)


class ManualWatering(Base):
    """Receipt for a user-requested simulated watering action."""
    __tablename__ = "manual_watering"

    requestId: Mapped[str] = mapped_column(String, primary_key=True)
    plantId: Mapped[str] = mapped_column(String)
    moistureBefore: Mapped[float] = mapped_column(Float)
    moistureAfter: Mapped[float] = mapped_column(Float)


class WateringCooldown(Base):
    """Persist the full-moisture hold across server restarts."""
    __tablename__ = "watering_cooldowns"
    plantId: Mapped[str] = mapped_column(String, primary_key=True)
    until: Mapped[float] = mapped_column(Float)


class GameCheckpoint(Base):
    """JSON game state: shared encounters and alternation survive server restart."""
    __tablename__ = "game_checkpoint"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    payload: Mapped[str] = mapped_column(String)


class HardwareWatering(Base):
    """Persist command attempts so an HTTP retry never pumps twice."""
    __tablename__ = "hardware_watering"
    requestId: Mapped[str] = mapped_column(String, primary_key=True)
    plantId: Mapped[str] = mapped_column(String)
    payload: Mapped[str] = mapped_column(String)
