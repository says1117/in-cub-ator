<!-- server/CLAUDE.md: Instructions for Claude working on the server. Owner: Role 2 (server). -->

# CLAUDE.md

Edit only `/server` (ask before touching other folders). The game rules are pure Python in `app/state_machine.py`,
`app/battle.py` and `app/rewards.py`, with no I/O, so they are unit tested (`python -m pytest` from `server/`).
`app/main.py` wires MQTT, the state machine, the camera and the WebSocket. Topics and the state message are in `/CONTRACT.md`;
changing either needs all three roles to agree. Every number lives in `config.py` or `data/*.json`. Keep Python 3.8 compatible
(the Jetson), use `from __future__ import annotations`, and never block the asyncio loop.
