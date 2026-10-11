#!/usr/bin/env bash
# server/tools/force_boss.sh: Triggers the boss override from the command line. Owner: Role 2 (server).
# Usage: ./force_boss.sh [A|B] [host:port]
POT="${1:-A}"
HOST="${2:-localhost:8000}"
curl -fsS -X POST "http://${HOST}/api/debug/boss/${POT}" && echo
