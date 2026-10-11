# server/tests/test_battle.py: Tests for the fight rules. Owner: Role 2 (server).
from app import battle
from app.models import BossConfig, CreatureProfile, Pot

BOSS = BossConfig(hp=30, attack=100, reward_xp=10, round_seconds=1.0)


def pot_with_creature():
    p = Pot("A", creature=CreatureProfile("X", "T", 20, 10, "#fff"))
    battle.start_battle(p, BOSS)
    return p


def test_no_creature_no_progress():
    p = Pot("A")
    battle.start_battle(p, BOSS)
    assert battle.step(p, BOSS, 10) == "" and p.boss_hp == 30


def test_creature_wins_and_never_faints():
    p = pot_with_creature()
    results = [battle.step(p, BOSS, 1.0) for _ in range(5)]
    assert "won" in results
    assert p.creature_hp >= 1


def test_big_dt_runs_multiple_rounds():
    p = pot_with_creature()
    assert battle.step(p, BOSS, 5.0) == "won"
