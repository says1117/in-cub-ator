"""TEMPORARY: a made-up moisture percentage for plant A, so the game can be played
without a sensor. Run the server with `python3 main.py --sim`.

The percentage wanders toward a random target (sometimes 0, sometimes wet) at a steady
speed. When the plant is watered by a pump command, the percentage jumps up.
"""
import random

import config as C


class MoistureSim:
    def __init__(self, rng=None, start=80.0):
        self.rng = rng or random.Random()
        self.pct = start
        self.target = start
        self.hold = 0.0  # seconds to stay at the target before picking a new one

    def _pick_target(self):
        roll = self.rng.random()
        if roll < 0.20:
            return 0.0                                # bone dry, the very strong dragon
        if roll < 0.35:
            return self.rng.uniform(80.0, 100.0)      # wet, everything is chill
        return self.rng.uniform(0.0, 100.0)

    def step(self, dt: float) -> float:
        if abs(self.pct - self.target) < 0.01:
            self.hold -= dt
            if self.hold <= 0:
                self.target = self._pick_target()
                self.hold = self.rng.uniform(4.0, 12.0)
        else:
            move = C.SIM_SPEED_PCT_PER_SEC * dt
            delta = self.target - self.pct
            self.pct += max(-move, min(move, delta))
        self.pct = min(100.0, max(0.0, self.pct))
        return self.pct

    def watered(self, pump_ms: int):
        """A pump command was sent: the soil gets wetter."""
        self.pct = min(100.0, self.pct + pump_ms / 1000.0 * C.SIM_WATER_PCT_PER_SECOND_OF_PUMP)
        self.target = self.pct

    def raw(self) -> int:
        """The percentage as the raw sensor number the server expects."""
        return round(C.SOIL_RAW_DRY + (C.SOIL_RAW_WET - C.SOIL_RAW_DRY) * self.pct / 100.0)
