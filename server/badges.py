"""Victory badges: one permanent collectible for every won fight. Ported from okayuu-branch
(server/app/badges.py), kept in a small JSON file instead of that branch's database.

The designs cycle through DESIGNS and the rank goes up each time round, so badge 9 is the second
Dew Guardian (Rank 2). A badge never depends on watering: a wet pot or an offline pump still earns
one. Saving is best effort: a file problem is logged and the game carries on."""
import json
import logging
import os
import time
from typing import Optional

log = logging.getLogger("badges")

DESIGNS = (
    ("Dew Guardian", "drop", "#74d8ff"),
    ("Sun Champion", "sun", "#ffd77a"),
    ("Leaf Defender", "leaf", "#9ce7a0"),
    ("Spore Sentinel", "spore", "#dcc0fb"),
    ("Bloom Hero", "flower", "#ff9bc5"),
    ("Root Protector", "root", "#e6b889"),
    ("Storm Striker", "bolt", "#afbbff"),
    ("Forest Crown", "crown", "#ffdf91"),
)


def badge_view(row: dict) -> dict:
    """What the screen gets for one earned badge (the same fields as okayuu's API)."""
    name, motif, color = DESIGNS[(row["number"] - 1) % len(DESIGNS)]
    rank = (row["number"] - 1) // len(DESIGNS) + 1
    return {"id": row["battleId"], "type": f"{motif}-{rank}", "number": row["number"],
            "name": f"{name} · Rank {rank}", "motif": motif, "color": color, "rank": rank,
            "boss": row["boss"], "plantId": row["plantId"], "earnedAt": row["earnedAt"]}


class BadgeBook:
    def __init__(self, path: Optional[str] = None):
        self.path = path          # None: kept in memory only (tests)
        self.rows = []
        if path and os.path.exists(path):
            try:
                with open(path) as f:
                    self.rows = [r for r in json.load(f) if isinstance(r, dict) and "number" in r]
            except (OSError, ValueError) as error:
                log.warning("could not read %s (%s): starting an empty collection", path, error)

    def award(self, battle_id: str, boss: str, plant: str, now: Optional[float] = None) -> Optional[dict]:
        """The badge for a won fight. The same fight never earns two."""
        if not battle_id:
            return None
        for row in self.rows:
            if row["battleId"] == battle_id:
                return badge_view(row)
        row = {"battleId": battle_id, "number": len(self.rows) + 1, "boss": boss or "unknown",
               "plantId": plant, "earnedAt": time.time() if now is None else now}
        self.rows.append(row)
        self._save()
        return badge_view(row)

    def collection(self) -> list:
        return [badge_view(r) for r in self.rows]

    def _save(self):
        if not self.path:
            return
        try:
            tmp = self.path + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.rows, f)
            os.replace(tmp, self.path)
        except OSError as error:
            log.warning("could not save badges to %s: %s", self.path, error)
