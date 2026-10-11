"""Distinct victory collectibles derived from a durable victory number."""
from .models import VictoryBadge

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


def badge_to_dict(row):
    name, motif, color = DESIGNS[(row.number - 1) % len(DESIGNS)]
    rank = (row.number - 1) // len(DESIGNS) + 1
    return {"id": row.battleId, "type": f"{motif}-{rank}", "number": row.number,
            "name": f"{name} · Rank {rank}", "motif": motif, "color": color,
            "rank": rank, "boss": row.boss, "plantId": row.plantId, "earnedAt": row.earnedAt}


def collection(db):
    return [badge_to_dict(row) for row in db.query(VictoryBadge).order_by(VictoryBadge.number).all()]
