"""Reward function. Pure: turns a win into a bounded command or nothing."""
from collections import namedtuple
from typing import Optional

from . import config as C

Command = namedtuple("Command", "topic payload")


def water_reward(plant: str, soil_pct: float, now: float, last_reward_at: float,
                 demo: bool = False, tier: int = 1) -> Optional[Command]:
    """A beaten demo boss may water wet soil. The pump cap and the gap still apply."""
    if soil_pct >= C.SOIL_WET_THRESHOLD_PCT and not demo:
        return None
    if now - last_reward_at < C.REWARD_MIN_GAP_SECONDS:
        return None
    ms = min(C.PUMP_MS_BY_TIER.get(tier, C.PUMP_MS_PER_WIN), C.PUMP_MAX_MS)
    return Command(C.TOPIC_CMD_PUMP.format(plant=plant), str(ms))
