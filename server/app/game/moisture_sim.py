"""TEMPORARY: a made-up moisture percentage for one plant, so the game can be played
without a sensor. Run the server with `python3 main.py --sim`.

It behaves like soil in a pot: it dries slowly and steadily, and only a pump command makes it
wetter. After a watering the soil stays soaked for a while before it starts to dry again, so
a plant that has just been watered does not call another boss for a good while.
"""
import random

from . import config as C


class MoistureSim:
    def __init__(self, rng=None, start=80.0):
        self.rng = rng or random.Random()
        self.pct = start
        self.soak = 0.0  # seconds left before the soil starts drying again
        self.rate = self._pick_rate()

    def _pick_rate(self):
        """Percent lost per second. Picked again after each watering, so no two dry spells match."""
        return self.rng.uniform(*C.SIM_DRY_PCT_PER_SEC)

    def step(self, dt: float) -> float:
        if self.soak > 0:
            self.soak -= dt
        else:
            self.pct -= self.rate * dt * self.rng.uniform(0.7, 1.3)  # a little uneven, like real soil
        self.pct = min(100.0, max(0.0, self.pct))
        return self.pct

    def watered(self, pump_ms: int):
        """A pump command was sent: the soil gets properly wet and holds it for a while."""
        gain = pump_ms / 1000.0 * C.SIM_WATER_PCT_PER_SECOND_OF_PUMP
        self.pct = min(100.0, max(self.pct + gain, C.SIM_WATERED_AT_LEAST_PCT))
        self.soak = C.SIM_SOAK_SECONDS
        self.rate = self._pick_rate()

    def raw(self) -> int:
        """The percentage as the raw sensor number the server expects."""
        return round(C.SOIL_RAW_DRY + (C.SOIL_RAW_WET - C.SOIL_RAW_DRY) * self.pct / 100.0)
