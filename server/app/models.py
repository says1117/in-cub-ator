
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
