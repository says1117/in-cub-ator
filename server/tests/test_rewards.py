# server/tests/test_rewards.py: Tests for XP, levels and saving. Owner: Role 2 (server).
from app import rewards
from app.models import BossConfig, CreatureProfile


def test_level_up_and_stats():
    c = CreatureProfile("X", "T", 30, 6, "#fff", xp=90)
    assert c.level == 1
    assert rewards.grant_win(c, BossConfig(reward_xp=40))
    assert c.level == 2 and c.attack == 8 and c.max_hp == 36


def test_save_and_load_roundtrip(tmp_path):
    p = tmp_path / "sub" / "progress.json"
    rewards.save_progress(p, {"AA": 55})
    assert rewards.load_progress(p) == {"AA": 55}
    assert rewards.load_progress(tmp_path / "missing.json") == {}
