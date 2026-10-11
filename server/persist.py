"""The pump log and today's stats on disk, so pump safety survives a restart. The only file I/O.

File (git-ignored), wall-clock seconds:
    {"v": 1, "pumps": {"A": [[epoch_s, ms], ...], "B": [...]},
     "stats": {"date": "2026-10-11", "fights": 3, "wins": 2, "waterings": 2, "water_ms": 4000}}

The engine works on the monotonic clock, so this module speaks in AGES (seconds ago) both ways:
load() turns epochs into ages, save() turns ages back into epochs. Rules:
  - entries older than the budget window are dropped;
  - an entry from the future (the wall clock jumped back) counts as just now;
  - an unreadable or malformed file counts as one PUMP_MAX_MS pump per plant just now, so a
    damaged log can only ever mean less water, never more;
  - writes are atomic: a temp file, then os.replace."""
import json
import logging
import math
import os
from typing import Optional

import config as C

log = logging.getLogger("persist")

VERSION = 1
OK, MISSING, CORRUPT = "ok", "missing", "corrupt"


def _conservative():
    return {p: [(0.0, C.PUMP_MAX_MS)] for p in C.PLANTS}


def _valid_stats(raw) -> Optional[dict]:
    if not isinstance(raw, dict) or not isinstance(raw.get("date"), str):
        return None
    out = {"date": raw["date"]}
    for key in ("fights", "wins", "waterings", "water_ms"):
        value = raw.get(key, 0)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            return None
        out[key] = value
    return out


def parse(text: str, now_wall: float) -> dict:
    """File contents -> {"pumps": {plant: [(age_s, ms)]}, "stats": dict|None, "status": ...}."""
    try:
        raw = json.loads(text)
        if not isinstance(raw, dict) or raw.get("v") != VERSION or not isinstance(raw.get("pumps"), dict):
            raise ValueError("not a pump log")
        pumps = {}
        for plant in C.PLANTS:
            entries = raw["pumps"].get(plant, [])
            if not isinstance(entries, list):
                raise ValueError("bad entries")
            ages = []
            for entry in entries:
                if not (isinstance(entry, list) and len(entry) == 2):
                    raise ValueError("bad entry")
                epoch, ms = entry
                if isinstance(epoch, bool) or isinstance(ms, bool) \
                        or not isinstance(epoch, (int, float)) or not isinstance(ms, (int, float)) \
                        or not math.isfinite(epoch) or not math.isfinite(ms) or ms < 0:
                    raise ValueError("bad entry")
                age = max(0.0, now_wall - epoch)        # from the future: counts as now
                if age < C.PUMP_BUDGET_WINDOW_SECONDS:
                    ages.append((age, int(ms)))
            pumps[plant] = ages
        return {"pumps": pumps, "stats": _valid_stats(raw.get("stats")), "status": OK}
    except (ValueError, TypeError, AttributeError) as error:
        log.warning("pump log unreadable (%s): assuming a full pump per plant just now", error)
        return {"pumps": _conservative(), "stats": None, "status": CORRUPT}


def load(path: str, now_wall: float) -> dict:
    if not os.path.exists(path):
        return {"pumps": {p: [] for p in C.PLANTS}, "stats": None, "status": MISSING}
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as error:
        log.warning("pump log unreadable (%s): assuming a full pump per plant just now", error)
        return {"pumps": _conservative(), "stats": None, "status": CORRUPT}
    return parse(text, now_wall)


def dumps(persisted: dict, now_wall: float) -> str:
    """{"pumps": {plant: [(age_s, ms)]}, "stats": dict} -> file contents (epochs)."""
    pumps = {
        plant: [[round(now_wall - age, 3), int(ms)]
                for age, ms in persisted.get("pumps", {}).get(plant, [])
                if age < C.PUMP_BUDGET_WINDOW_SECONDS]
        for plant in C.PLANTS
    }
    return json.dumps({"v": VERSION, "pumps": pumps, "stats": persisted.get("stats")}, sort_keys=True)


def save(path: str, persisted: dict, now_wall: float) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(dumps(persisted, now_wall))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
