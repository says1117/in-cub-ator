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
    source: Optional[str] = None   # C.SOURCE_SOIL or C.SOURCE_DEMO while a boss is active
    mode_until: float = 0.0
    dry_streak: dict = None
    cooldown_until: dict = None
    stale: bool = False
    tier: int = 0        # strength of the active boss, set when it spawns
    last_tier: int = 0   # strength of the last boss, a harder one may skip the cooldown
    last_pct: dict = None  # latest moisture of each plant, so the drier plant can be picked

    def __post_init__(self):
        if self.dry_streak is None:
            object.__setattr__(self, "dry_streak", {p: 0 for p in C.PLANTS})
        if self.cooldown_until is None:
            object.__setattr__(self, "cooldown_until", {p: 0.0 for p in C.PLANTS})
        if self.last_pct is None:
            object.__setattr__(self, "last_pct", {p: 100.0 for p in C.PLANTS})


def soil_pct(raw: int) -> float:
    """Raw ADC to 0 (dry) .. 100 (wet). Works for sensors that read high or low when dry."""
    span = C.SOIL_RAW_WET - C.SOIL_RAW_DRY
    return max(0.0, min(100.0, (raw - C.SOIL_RAW_DRY) / span * 100.0))


def tier_for(pct: float) -> int:
    """0 = chill, 1 = dry, 2 = very dry, 3 = bone dry."""
    if pct <= C.TIER3_AT_OR_BELOW_PCT:
        return 3
    if pct < C.TIER2_BELOW_PCT:
        return 2
    if pct < C.SOIL_DRY_THRESHOLD_PCT:
        return 1
    return 0


def _summon(g: Game, plant: str, now: float, source: str, tier: int = 1) -> Game:
    streaks = dict(g.dry_streak)
    streaks[plant] = 0
    return replace(
        g, mode=BOSS, boss_plant=plant, source=source, tier=tier, last_tier=tier,
        mode_until=now + C.BOSS_INTRO_SECONDS, dry_streak=streaks,
    )


def _to_walking(g: Game) -> Game:
    return replace(g, mode=WALKING, boss_plant=None, source=None, tier=0)


def on_soil(g: Game, plant: str, pct: float, now: float) -> Game:
    streaks = dict(g.dry_streak)
    streaks[plant] = streaks[plant] + 1 if pct < C.SOIL_DRY_THRESHOLD_PCT else 0
    seen = dict(g.last_pct)
    seen[plant] = pct
    g = replace(g, dry_streak=streaks, last_pct=seen)

    if g.mode in (WALKING, COOLDOWN):
        if all(tier_for(v) == 0 for v in seen.values()):
            g = replace(g, last_tier=0)  # every plant is fine, the next dip starts fresh
        # Any dry plant may call a boss. A harder tier than the last boss may skip the cooldown.
        ready = [
            p for p in C.PLANTS
            if tier_for(seen[p]) >= 1
            and streaks[p] >= C.SOIL_DRY_READINGS_N
            and (now >= g.cooldown_until[p] or tier_for(seen[p]) > g.last_tier)
        ]
        if ready:
            drier = min(ready, key=lambda p: seen[p])  # the thirstier plant goes first
            return _summon(g, drier, now, C.SOURCE_SOIL, tier_for(seen[drier]))
    elif g.mode in (BOSS, BATTLE) and plant == g.boss_plant and g.source == C.SOURCE_SOIL:
        if pct > C.SOIL_WET_THRESHOLD_PCT:
            return _to_walking(g)
    return g


def on_tick(g: Game, now: float) -> Game:
    if g.mode == BOSS and now >= g.mode_until:
        return replace(g, mode=BATTLE)
    if g.mode == REWARD and now >= g.mode_until:
        return replace(g, mode=COOLDOWN, boss_plant=None, source=None, tier=0,
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
    g = replace(g, mode=COOLDOWN, boss_plant=None, source=None, tier=0,
                cooldown_until=cool, mode_until=cool[plant])
    return g, None


def on_demo(g: Game, plant: str, now: float, tier: int = 1) -> Game:
    """Demo button. Spawns a boss whatever the soil says. Ignored if a boss, battle or
    reward is already active. Everything after the spawn is the normal flow."""
    if g.mode in (WALKING, COOLDOWN):
        return _summon(g, plant, now, C.SOURCE_DEMO, tier)
    return g


def on_status(g: Game, online: bool) -> Game:
    """Offline: mark readings stale and drop any active boss or battle, back to the walk."""
    g = replace(g, stale=not online)
    if not online and g.mode in (BOSS, BATTLE):
        g = _to_walking(g)
    return g
