"""The WebSocket contract with the game screen. Pure and stdlib-only, so it is testable anywhere.

Client -> server:  {"action": "move", "move": "guard", "turn": 2}   (turn optional, for old clients)
                   {"action": "demo_boss"}
Anything else (bad JSON, a list, unknown actions, wrong types) is ignored.

Server -> client: the state message built by GameEngine.snapshot(). Some keys depend only on the
clock (VOLATILE); change detection ignores them, so a countdown alone never causes a broadcast."""
import copy
import json
from typing import Optional, Tuple

import config as C

VOLATILE = {"battle": ("move_deadline_in_ms",)}

MOVE_TOPIC = "ws/" + C.WS_ACTION_MOVE
DEMO_TOPIC = "ws/" + C.WS_ACTION_DEMO_BOSS


def parse_client_message(text) -> Optional[Tuple[str, str]]:
    """A raw WebSocket message -> (topic, payload) for main.route, or None to ignore it."""
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    action = data.get("action")
    if action == C.WS_ACTION_DEMO_BOSS:
        return DEMO_TOPIC, ""
    if action == C.WS_ACTION_MOVE:
        move = data.get("move")
        turn = data.get("turn")
        if turn is not None and not _is_int(turn):
            turn = -1                 # present but not a number: it can never match, so it is dropped
        return MOVE_TOPIC, json.dumps({"move": move if isinstance(move, str) else "", "turn": turn})
    return None


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def parse_move(payload) -> Tuple[str, Optional[int]]:
    """route() payload -> (move, turn). turn None = untagged; -1 = "I'm here, but this is not a
    move for any turn" (never matches). A bare move string is accepted too."""
    try:
        data = json.loads(payload) if isinstance(payload, str) else payload
    except ValueError:
        data = None
    if isinstance(data, dict):
        move = data.get("move") if isinstance(data.get("move"), str) else ""
        turn = data.get("turn")
        return move, (turn if _is_int(turn) else None)
    return (payload.strip() if isinstance(payload, str) else ""), None


def stable(snapshot: dict) -> dict:
    """The snapshot without its clock-only keys, for change detection."""
    out = copy.copy(snapshot)
    for section, keys in VOLATILE.items():
        if isinstance(out.get(section), dict):
            out[section] = {k: v for k, v in out[section].items() if k not in keys}
    return out


def encode(snapshot: dict) -> str:
    return json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
