# server/app/rewards.py: XP rewards and progress saving. Owner: Role 2 (server).
from __future__ import annotations

import json
from pathlib import Path

from .models import BossConfig, CreatureProfile


def grant_win(creature: CreatureProfile, boss: BossConfig) -> bool:
    """Give XP for a win. Returns True when the creature levelled up."""
    before = creature.level
    creature.xp += boss.reward_xp
    return creature.level > before


def load_progress(path: Path) -> dict:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return {}


def save_progress(path: Path, xp_by_uid: dict) -> None:
    path = Path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(xp_by_uid, indent=2))
        tmp.replace(path)
    except OSError:
        pass  # progress is a nicety; never crash the game over it
