"""Boss state machine as pure functions. No I/O, no clock: callers pass `now`."""
from dataclasses import dataclass, replace
from typing import Optional, Tuple

import config as C

WALKING = "walking"
BOSS = "boss"
BATTLE = "battle"
REWARD = "reward"
COOLDOWN = "cooldown"


@dataclass(frozen=True)
class Game:
    mode: str = WALKING
    boss_plant: Optional[str] = None
    forced: bool = False
    mode_until: float = 0.0
    dry_streak: dict = None
    cooldown_until: dict = None
    stale: bool = False

    def __post_init__(self):
        if self.dry_streak is None:
            object.__setattr__(self, "dry_streak", {p: 0 for p in C.PLANTS})
        if self.cooldown_until is None:
            object.__setattr__(self, "cooldown_until", {p: 0.0 for p in C.PLANTS})


def soil_pct(raw: int) -> float:
    """Raw ADC to 0 (dry) .. 100 (wet). Works for sensors that read high or low when dry."""
    span = C.SOIL_RAW_WET - C.SOIL_RAW_DRY
    return max(0.0, min(100.0, (raw - C.SOIL_RAW_DRY) / span * 100.0))


def _summon(g: Game, plant: str, now: float, forced: bool) -> Game:
    streaks = dict(g.dry_streak)
    streaks[plant] = 0
    return replace(
        g, mode=BOSS, boss_plant=plant, forced=forced,
        mode_until=now + C.BOSS_INTRO_SECONDS, dry_streak=streaks,
    )


def on_soil(g: Game, plant: str, pct: float, now: float) -> Game:
    streaks = dict(g.dry_streak)
    streaks[plant] = streaks[plant] + 1 if pct < C.SOIL_DRY_THRESHOLD_PCT else 0
    g = replace(g, dry_streak=streaks)

    if g.mode in (WALKING, COOLDOWN):
        if streaks[plant] >= C.SOIL_DRY_READINGS_N and now >= g.cooldown_until[plant]:
            return _summon(g, plant, now, forced=False)
    elif g.mode == BOSS and plant == g.boss_plant and not g.forced:
        if pct > C.SOIL_WET_THRESHOLD_PCT:
            return replace(g, mode=WALKING, boss_plant=None)
    return g


def on_tick(g: Game, now: float) -> Game:
    if g.mode == BOSS and now >= g.mode_until:
        return replace(g, mode=BATTLE)
    if g.mode == REWARD and now >= g.mode_until:
        return replace(g, mode=COOLDOWN, boss_plant=None, forced=False,
                       mode_until=max(g.cooldown_until.values()))
    if g.mode == COOLDOWN and now >= g.mode_until:
        return replace(g, mode=WALKING)
    return g


def on_battle_done(g: Game, won: bool, now: float) -> Tuple[Game, Optional[str]]:
    """Returns the new state and the plant to reward (None on a loss)."""
    if g.mode != BATTLE:
        return g, None
    plant = g.boss_plant
    cool = dict(g.cooldown_until)
    cool[plant] = now + C.COOLDOWN_SECONDS
    if won:
        g = replace(g, mode=REWARD, cooldown_until=cool,
                    mode_until=now + C.REWARD_DISPLAY_SECONDS)
        return g, plant
    g = replace(g, mode=COOLDOWN, boss_plant=None, forced=False,
                cooldown_until=cool, mode_until=cool[plant])
    return g, None


def on_force(g: Game, plant: Optional[str], now: float) -> Game:
    """Demo override. plant=None clears the boss."""
    if plant is None:
        if g.mode in (BOSS, BATTLE):
            return replace(g, mode=WALKING, boss_plant=None, forced=False)
        return g
    if g.mode in (WALKING, COOLDOWN, BOSS):
        cool = dict(g.cooldown_until)
        cool[plant] = 0.0
        return _summon(replace(g, cooldown_until=cool), plant, now, forced=True)
    return g


def on_status(g: Game, online: bool) -> Game:
    return replace(g, stale=not online)
