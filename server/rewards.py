"""Reward function. Pure: turns a win into a bounded pump command, or a reason for none.

Every rule here only ever removes water, never adds it:
  offline      no fresh soil reading for that plant (or the ESP32 is stale)  -> nothing
  soil_wet     the soil is already wet -> nothing (a demo boss gets a small sip instead)
  pump_resting the plant was pumped less than REWARD_MIN_GAP_SECONDS ago  -> nothing
  budget       the last hour's pumping plus this one would pass PUMP_BUDGET_MS_PER_HOUR -> nothing
  and no command is ever longer than PUMP_MAX_MS.
`pumps` is that plant's pump log as (time, ms) pairs on the same clock as `now`."""
from collections import namedtuple
from typing import Iterable, Optional, Tuple

import config as C

Command = namedtuple("Command", "topic payload")

OFFLINE = "offline"
SOIL_WET = "soil_wet"
PUMP_RESTING = "pump_resting"
BUDGET = "budget"
PUBLISH_FAILED = "publish_failed"


def pumped_in_window(pumps: Iterable, now: float) -> int:
    """ms pumped within the budget window. Entries from the future count as now."""
    return sum(ms for t, ms in pumps if now - min(t, now) < C.PUMP_BUDGET_WINDOW_SECONDS)


def last_pump_at(pumps: Iterable) -> Optional[float]:
    times = [t for t, _ in pumps]
    return max(times) if times else None


def water_decision(plant: str, soil_pct: float, now: float, pumps: Iterable = (),
                   fresh: bool = True, demo: bool = False,
                   tier: int = 1) -> Tuple[Optional[Command], Optional[str]]:
    """(command, None) when the plant may drink, else (None, blocked reason)."""
    pumps = list(pumps)
    if not fresh:
        return None, OFFLINE
    ms = C.PUMP_MS_BY_TIER.get(tier, C.PUMP_MS_PER_WIN)
    if soil_pct >= C.SOIL_WET_THRESHOLD_PCT:
        if not demo:
            return None, SOIL_WET
        ms = min(ms, C.DEMO_SIP_MS)
    last = last_pump_at(pumps)
    if last is not None and now - min(last, now) < C.REWARD_MIN_GAP_SECONDS:
        return None, PUMP_RESTING
    ms = min(ms, C.PUMP_MAX_MS)
    if pumped_in_window(pumps, now) + ms > C.PUMP_BUDGET_MS_PER_HOUR:
        return None, BUDGET
    return Command(C.TOPIC_CMD_PUMP.format(plant=plant), str(ms)), None


def water_reward(plant: str, soil_pct: float, now: float, last_reward_at: float,
                 demo: bool = False, tier: int = 1) -> Optional[Command]:
    """The older single-gap form, kept for callers that only know the last reward time."""
    pumps = [] if last_reward_at == float("-inf") else [(last_reward_at, 0)]
    cmd, _ = water_decision(plant, soil_pct, now, pumps, fresh=True, demo=demo, tier=tier)
    return cmd
