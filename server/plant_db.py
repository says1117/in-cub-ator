"""Plant database: real plants mapped by NFC tag, their moves, and saved level and XP.

Plants and moves come from JSON files committed to git (data/plants.json, data/moves.json).
Level and XP live in a small SQLite file on the Jetson (data/progress.db, not committed).
Everything is loaded into memory at start-up, so lookups during a battle never wait on the
disk or the network. Saving XP after a win is short, and a failed save never stops the game:
the progress stays in memory and is saved again with the next win.

Tag UIDs are normalised to uppercase hex with no separators, the form the ESP32 sends."""
import json
import logging
import os
import sqlite3
import string
import threading
from contextlib import closing
from dataclasses import MISSING, dataclass, field, fields
from typing import Dict, Iterable, List, Optional, Tuple

import config as C

log = logging.getLogger("plant_db")

HEX = set(string.hexdigits.upper())
UID_MIN_HEX = 8    # 4-byte tag
UID_MAX_HEX = 20   # 10-byte tag
SAVE_RETRY_SECONDS = 5.0


def normalize_uid(text: Optional[str]) -> Optional[str]:
    """'04:50:aa:01' -> '0450AA01'. Returns '' for an empty pad and None for something that is
    not a tag ID at all."""
    if text is None:
        return ""
    cleaned = "".join(ch for ch in text.strip().upper() if ch not in ": -")
    if cleaned == "":
        return ""
    if len(cleaned) % 2 or not (UID_MIN_HEX <= len(cleaned) <= UID_MAX_HEX) or not set(cleaned) <= HEX:
        return None
    return cleaned


@dataclass(frozen=True)
class Move:
    move_id: str
    name: str
    category: str          # attack, guard, special or skill
    type: str
    power: int             # percent of the plant's attack
    animation_key: str
    animation: dict = field(default_factory=dict)  # {"body": ..., "fx": ...} for the game screen
    skill_key: str = ""    # skill moves only: a key of config.SKILLS


@dataclass(frozen=True)
class PlantDef:
    plant_id: str
    tag_uid: str
    name: str
    species: str
    type: str
    base_hp: int
    base_atk: int
    skill: str
    moves: Dict[str, str]  # category -> move_id
    sprite_key: str
    animation_set_key: str


def _require(cond: bool, message: str):
    if not cond:
        raise ValueError(message)


def _records(path: str, key: str) -> list:
    with open(path) as f:
        data = json.load(f)
    _require(isinstance(data, dict) and isinstance(data.get(key), list), f"{path}: needs a '{key}' list")
    return data[key]


def _is_text(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def _is_whole(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _check_record(raw, cls, kinds: dict, where: str):
    """Checks a JSON record has every field the dataclass needs, no unknown ones, and the right kinds."""
    _require(isinstance(raw, dict), f"{where}: each entry must be an object")
    names = {f.name for f in fields(cls)}
    required = {f.name for f in fields(cls) if f.default is MISSING and f.default_factory is MISSING}
    unknown = set(raw) - names
    missing = required - set(raw)
    _require(not unknown, f"{where}: unknown field(s) {', '.join(sorted(unknown))}")
    _require(not missing, f"{where}: missing field(s) {', '.join(sorted(missing))}")
    for name, check in kinds.items():
        if name in raw:
            _require(check(raw[name]), f"{where}: field {name!r} has the wrong kind of value: {raw[name]!r}")


def load_moves(path: str = C.MOVES_FILE) -> Dict[str, Move]:
    moves = {}
    for i, raw in enumerate(_records(path, "moves")):
        _check_record(raw, Move, {
            "move_id": _is_text, "name": _is_text, "category": _is_text, "type": _is_text,
            "power": _is_whole, "animation_key": _is_text, "skill_key": lambda v: isinstance(v, str),
            "animation": lambda v: isinstance(v, dict) and set(v) == {"body", "fx"}
                         and all(_is_text(x) for x in v.values()),
        }, f"{path} move {i + 1}")
        _require("animation" in raw, f"{path} move {i + 1}: needs an animation {{body, fx}}")
        m = Move(**raw)
        _require(m.move_id and m.move_id not in moves, f"move id missing or repeated: {m.move_id!r}")
        _require(m.category in C.MOVE_CATEGORIES, f"{m.move_id}: unknown category {m.category!r}")
        _require(isinstance(m.power, int) and C.MOVE_POWER_MIN <= m.power <= C.MOVE_POWER_MAX,
                 f"{m.move_id}: power must be a whole number from {C.MOVE_POWER_MIN} to {C.MOVE_POWER_MAX}")
        if m.category == "skill":
            _require(m.skill_key in C.SKILLS, f"{m.move_id}: skill_key {m.skill_key!r} is not in config.SKILLS")
        _require(bool(m.animation_key), f"{m.move_id}: needs an animation_key")
        moves[m.move_id] = m
    return moves


def load_plants(moves: Dict[str, Move], path: str = C.PLANTS_FILE) -> Dict[str, PlantDef]:
    plants, uids = {}, set()
    for i, raw in enumerate(_records(path, "plants")):
        _check_record(raw, PlantDef, {
            "plant_id": _is_text, "tag_uid": _is_text, "name": _is_text, "species": _is_text,
            "type": _is_text, "skill": _is_text, "sprite_key": _is_text, "animation_set_key": _is_text,
            "base_hp": lambda v: _is_whole(v) and v > 0, "base_atk": lambda v: _is_whole(v) and v > 0,
            "moves": lambda v: isinstance(v, dict) and all(_is_text(k) and _is_text(x) for k, x in v.items()),
        }, f"{path} plant {i + 1}")
        uid = normalize_uid(raw.get("tag_uid"))
        _require(bool(uid), f"plant {raw.get('plant_id')!r}: tag_uid {raw.get('tag_uid')!r} is not a tag ID")
        p = PlantDef(**dict(raw, tag_uid=uid))
        _require(p.plant_id and p.plant_id not in plants, f"plant id missing or repeated: {p.plant_id!r}")
        _require(uid not in uids, f"{p.plant_id}: tag {uid} is used by another plant")
        _require(p.base_hp > 0 and p.base_atk > 0, f"{p.plant_id}: base_hp and base_atk must be above 0")
        _require(set(p.moves) == set(C.MOVE_CATEGORIES),
                 f"{p.plant_id}: needs exactly one move for each of {', '.join(C.MOVE_CATEGORIES)}")
        for category, move_id in p.moves.items():
            _require(move_id in moves, f"{p.plant_id}: unknown move {move_id!r}")
            _require(moves[move_id].category == category,
                     f"{p.plant_id}: {move_id} is a {moves[move_id].category} move, listed as {category}")
        _require(moves[p.moves["skill"]].skill_key == p.skill,
                 f"{p.plant_id}: skill {p.skill!r} does not match its skill move")
        plants[p.plant_id] = p
        uids.add(uid)
    return plants


def xp_to_reach(level: int) -> int:
    """Total XP needed to reach a level: 0 for level 1, then 50, 150, 300, ..."""
    return C.XP_LEVEL_STEP * (level - 1) * level // 2


def level_for_xp(xp: int) -> int:
    level = 1
    while level < C.MAX_LEVEL and xp >= xp_to_reach(level + 1):
        level += 1
    return level


def stats_at_level(plant: PlantDef, level: int) -> Tuple[int, int]:
    """(hp, atk) for a plant at a level. Modest growth so the bosses stay a fight."""
    level = max(1, min(level, C.MAX_LEVEL))
    hp = plant.base_hp + C.HP_PER_LEVEL * (level - 1)
    atk = plant.base_atk + (level - 1) // C.ATK_LEVELS_PER_POINT
    return hp, atk


class ProgressStore:
    """SQLite file with one row per award (battle, plant, xp). A plant's XP is the sum of its
    rows. Nothing is ever overwritten, so a battle can never pay twice (the row is ignored) and a
    failed read can never wipe saved progress."""

    def __init__(self, path: str = C.PROGRESS_DB):
        self.path = path
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with closing(self._connect()) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS awards (battle_id TEXT NOT NULL, plant_id TEXT NOT NULL, "
                       "xp INTEGER NOT NULL, PRIMARY KEY (battle_id, plant_id))")

    def _connect(self):
        return sqlite3.connect(self.path, timeout=1.0)

    def load(self) -> Tuple[Dict[str, int], set]:
        """(plant_id -> total xp, set of battle ids already paid)."""
        with closing(self._connect()) as db:
            totals = {pid: int(xp) for pid, xp in db.execute("SELECT plant_id, SUM(xp) FROM awards GROUP BY plant_id")}
            battles = {bid for (bid,) in db.execute("SELECT DISTINCT battle_id FROM awards")}
        return totals, battles

    def save(self, rows: List[Tuple[str, str, int]]) -> None:
        """Writes award rows in one transaction. Rows already saved are ignored, so retrying is safe."""
        with closing(self._connect()) as db, db:
            db.executemany("INSERT OR IGNORE INTO awards (battle_id, plant_id, xp) VALUES (?, ?, ?)", rows)


class PlantDB:
    """In-memory view of plants, moves and progress. Safe to use from the game loop: an award
    updates memory at once, and saving happens on a background thread (or straight away when
    background=False, for tests)."""

    def __init__(self, plants: Dict[str, PlantDef], moves: Dict[str, Move],
                 store: Optional[ProgressStore] = None, background: bool = True):
        self.plants = plants
        self.moves = moves
        self.store = store
        self.by_uid = {p.tag_uid: p for p in plants.values()}
        self.xp: Dict[str, int] = {pid: 0 for pid in plants}
        self.paid_battles = set()
        self._pending: List[Tuple[str, str, int]] = []  # award rows not saved yet
        self._lock = threading.Lock()          # guards _pending
        self._flush_lock = threading.Lock()    # one save at a time, so two saves never drop rows
        self._wake = threading.Event()
        if store is not None:
            try:
                totals, battles = store.load()
                for pid, xp in totals.items():
                    if pid in self.xp:
                        self.xp[pid] = max(0, xp)
                self.paid_battles |= battles
            except sqlite3.Error as err:
                log.warning("could not read saved progress (%s); levels start at 1 for now, nothing saved is lost", err)
        self._background = background and store is not None
        if self._background:
            threading.Thread(target=self._saver, name="plant-db-saver", daemon=True).start()

    @classmethod
    def load(cls, plants_path: str = C.PLANTS_FILE, moves_path: str = C.MOVES_FILE,
             progress_path: Optional[str] = C.PROGRESS_DB, background: bool = True) -> "PlantDB":
        moves = load_moves(moves_path)
        plants = load_plants(moves, plants_path)
        store = None
        if progress_path:
            try:
                store = ProgressStore(progress_path)
            except (sqlite3.Error, OSError) as err:
                log.warning("progress file unusable (%s); XP is kept in memory only this run", err)
        return cls(plants, moves, store, background)

    @property
    def unsaved(self) -> bool:
        with self._lock:
            return bool(self._pending)

    def lookup(self, uid_text: str) -> Optional[PlantDef]:
        uid = normalize_uid(uid_text)
        return self.by_uid.get(uid) if uid else None

    def level(self, plant_id: str) -> int:
        return level_for_xp(self.xp.get(plant_id, 0))

    def moves_of(self, plant: PlantDef) -> Dict[str, Move]:
        return {category: self.moves[mid] for category, mid in plant.moves.items()}

    def award(self, battle_id: str, plant_ids: Iterable[str], xp_each: int) -> Dict[str, dict]:
        """Gives xp_each to each plant once per battle. Returns plant_id -> {xp, level, levelled_up, gained}.
        Never raises and never blocks on the disk."""
        if not battle_id or battle_id in self.paid_battles or xp_each <= 0:
            return {}
        ids = [pid for pid in dict.fromkeys(plant_ids) if pid in self.plants]
        if not ids:
            return {}
        self.paid_battles.add(battle_id)
        result = {}
        for pid in ids:
            before = self.level(pid)
            self.xp[pid] += xp_each
            after = self.level(pid)
            result[pid] = {"xp": self.xp[pid], "level": after, "levelled_up": after > before, "gained": xp_each}
        if self.store is not None:
            with self._lock:
                self._pending.extend((battle_id, pid, xp_each) for pid in ids)
            if self._background:
                self._wake.set()
            else:
                self.flush()
        return result

    def flush(self) -> bool:
        """Saves every pending award row. Returns True when nothing is left unsaved."""
        if self.store is None:
            return True
        with self._flush_lock:
            return self._flush_locked()

    def _flush_locked(self) -> bool:
        with self._lock:
            rows = list(self._pending)
        if not rows:
            return True
        try:
            self.store.save(rows)
        except (sqlite3.Error, OSError) as err:
            log.warning("could not save progress (%s); it stays in memory and is retried", err)
            return False
        with self._lock:
            del self._pending[:len(rows)]
            return not self._pending

    def _saver(self):
        while True:
            self._wake.wait(timeout=SAVE_RETRY_SECONDS)
            self._wake.clear()
            self.flush()
