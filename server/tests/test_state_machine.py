# server/tests/test_state_machine.py: Tests for boss summoning, hysteresis and watering. Owner: Role 2 (server).
import config
from app.models import BossConfig
from app.state_machine import Game

BOSS = BossConfig(hp=20, attack=1, reward_xp=40, round_seconds=1.0)
CREATURES = {"default": {"name": "Sprout", "hp": 30, "attack": 10, "color": "#fff"}, "uids": {}}


def make():
    return Game(boss=BOSS, creatures=CREATURES, progress={})


def test_dry_soil_summons_boss_once():
    g = make()
    g.on_soil("A", config.SOIL["A"]["dry_at"], 0)
    g.tick(0.5, 0.5)
    assert g.pots["A"].phase == "boss"
    g.tick(1.0, 0.5)
    assert g.pots["A"].boss_hp == BOSS.hp  # no creature yet, so nothing is hit


def test_hysteresis_keeps_boss_between_thresholds():
    g = make()
    cal = config.SOIL["A"]
    g.on_soil("A", cal["dry_at"], 0)
    g.tick(0.5, 0.5)
    g.on_soil("A", (cal["dry_at"] + cal["wet_at"]) // 2, 1)
    assert g.pots["A"].dry and g.pots["A"].phase == "boss"
    g.on_soil("A", cal["wet_at"], 2)
    assert not g.pots["A"].dry and g.pots["A"].phase == "ok"


def test_win_sends_pump_and_gives_xp():
    g = make()
    g.on_pad("A", "04:a1:b2", 0)
    g.on_soil("A", config.SOIL["A"]["dry_at"] + 100, 0)
    cmds, t = [], 0.0
    for _ in range(10):
        t += 1.0
        cmds += g.tick(t, 1.0)
    assert ("pump", "A", config.PUMP_MS) in cmds
    assert g.pots["A"].phase == "watering"
    assert g.xp["04A1B2"] == BOSS.reward_xp


def test_watering_returns_to_ok_when_soil_wet_and_boss_returns_if_still_dry():
    g = make()
    g.on_pad("A", "AA", 0)
    g.on_soil("A", 3000, 0)
    t = 0.0
    for _ in range(5):
        t += 1.0
        g.tick(t, 1.0)
    assert g.pots["A"].phase == "watering"
    g.on_soil("A", 1500, t)
    assert g.pots["A"].phase == "ok"
    # still-dry case
    g2 = make()
    g2.on_pad("A", "AA", 0)
    g2.on_soil("A", 3000, 0)
    t = 0.0
    for _ in range(5):
        t += 1.0
        g2.tick(t, 1.0)
    g2.tick(t + config.WATER_SETTLE_SECONDS + 1, 1.0)
    g2.tick(t + config.WATER_SETTLE_SECONDS + 2, 1.0)
    assert g2.pots["A"].phase == "boss"


def test_force_boss_and_snapshot_shape():
    g = make()
    assert g.force_boss("B", 0)
    snap = g.snapshot(1)
    assert snap["pots"]["B"]["boss"]["hp"] == BOSS.hp
    assert snap["pots"]["A"]["boss"] is None


def test_pad_lift_removes_creature():
    g = make()
    g.on_pad("A", "AA", 0)
    g.on_pad("A", "", 1)
    assert g.pots["A"].creature is None
