"""Reward function. Pure: turns a win into a bounded command or nothing."""
from collections import namedtuple
from typing import Optional

import config as C

Command = namedtuple("Command", "topic payload")


def water_reward(plant: str, soil_pct: float, now: float, last_reward_at: float,
                 demo: bool = False, tier: int = 1) -> Optional[Command]:
    """A beaten demo boss may water wet soil. The pump cap always applies, and the wait between
    waterings if one is set (config.REWARD_MIN_GAP_SECONDS, 0 for none)."""
    if soil_pct >= C.SOIL_WET_THRESHOLD_PCT and not demo and not C.WATER_WET_SOIL:
        return None
    if now - last_reward_at < C.REWARD_MIN_GAP_SECONDS:
        return None
    ms = min(C.PUMP_MS_BY_TIER.get(tier, C.PUMP_MS_PER_WIN), C.PUMP_MAX_MS)
    return Command(C.TOPIC_CMD_PUMP.format(plant=plant), str(ms))

