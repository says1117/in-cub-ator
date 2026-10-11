#!/usr/bin/env bash
# firmware/tests/integration/phase4_check.sh: Guided Phase 4 test of the real ESP32 against a broker (Jetson or a laptop). Owner: Role 1 (firmware).
# Checks status, soil, pads, then pump safety (with you watching), then the offline last will.
# Pump runs are capped at 2 s by the firmware (config.h PUMP_MAX_RUN_MS).
# Needs mosquitto_sub and mosquitto_pub (brew install mosquitto). Results are saved to a log file.
#
# Usage:   firmware/tests/integration/phase4_check.sh <broker address> [port]
# Example: firmware/tests/integration/phase4_check.sh 192.168.1.50
#
# SAFETY: the pump steps switch real pumps. They only run after you confirm the pumps are under water.

set -u

HOST="${1:-}"
PORT="${2:-1883}"
if [ -z "$HOST" ]; then
  echo "Usage: $0 <broker address> [port]"
  exit 2
fi
for tool in mosquitto_sub mosquitto_pub; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool. Install it with: brew install mosquitto"
    exit 2
  fi
done

# Ignore any personal mosquitto_pub/mosquitto_sub settings file, so nothing can add -r (retained)
# or change the QoS behind our back.
XDG_CONFIG_HOME="$(mktemp -d)"
export XDG_CONFIG_HOME

LOG="phase4_results_$(date +%Y%m%d_%H%M%S).txt"
PASS=0
FAIL=0
SKIP=0

say() { echo "$*" | tee -a "$LOG"; }
result() {  # result PASS|FAIL|SKIP "what"
  case "$1" in
    PASS) PASS=$((PASS + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    SKIP) SKIP=$((SKIP + 1)) ;;
  esac
  say "  [$1] $2"
}
ask_yes() {  # ask_yes "question" -> returns 0 for y
  local answer
  read -r -p "$1 [y/n] " answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}
sub_one() {  # sub_one <topic> <seconds>: prints one message payload, or nothing on timeout
  mosquitto_sub -h "$HOST" -p "$PORT" -q 0 -t "$1" -C 1 -W "$2" 2>/dev/null
}
pump() {  # pump A|B <payload>: never retained, QoS 0, as CONTRACT.md requires
  if ! mosquitto_pub -h "$HOST" -p "$PORT" -q 0 -t "incube/cmd/pump/$1" -m "$2"; then
    say "  could not send '$2' to pump $1"
    return 1
  fi
}
wait_seconds() {  # wait_seconds <n> <why>
  say "  Waiting $1 s ($2)..."
  sleep "$1"
}

say "Phase 4 check against $HOST:$PORT, $(date)"
say "Log file: $LOG"
say ""

say "1. Broker reachable"
if mosquitto_pub -h "$HOST" -p "$PORT" -q 0 -t incube/selftest -m ping 2>/dev/null; then
  result PASS "can publish to the broker"
else
  result FAIL "cannot reach the broker at $HOST:$PORT (wrong address, broker not running, or firewall)"
  say "Stopping: nothing else can work without the broker."
  exit 1
fi

say ""
say "2. ESP32 status (retained)"
STATUS="$(sub_one incube/status/esp32 5)"
if [ "$STATUS" = "online" ]; then
  result PASS "status is online"
else
  result FAIL "status is '${STATUS:-nothing}' (expected online). Is the ESP32 powered and on the same Wi-Fi?"
fi

say ""
say "3. Soil readings (expect one every 2 s, whole numbers 0 to 4095)"
for SENSOR in A B; do
  # %U is the arrival time in seconds (with fractions), %p is the payload: one line per message.
  LINES="$(mosquitto_sub -h "$HOST" -p "$PORT" -q 0 -t "incube/soil/$SENSOR" -C 3 -W 10 -F '%U %p' 2>/dev/null)"
  COUNT=0
  OK=1
  PREV=""
  GAPS=""
  while IFS=' ' read -r STAMP VALUE EXTRA; do
    [ -z "$STAMP" ] && continue
    COUNT=$((COUNT + 1))
    case "$VALUE" in
      ''|*[!0-9]*) OK=0 ;;
      *) if [ ${#VALUE} -gt 4 ] || [ "$VALUE" -gt 4095 ]; then OK=0; fi ;;
    esac
    [ -n "${EXTRA:-}" ] && OK=0
    if [ -n "$PREV" ]; then
      GAP=$(awk -v a="$PREV" -v b="$STAMP" 'BEGIN { printf "%.1f", b - a }')
      GAPS="$GAPS $GAP"
      awk -v a="$PREV" -v b="$STAMP" 'BEGIN { g = b - a; exit !(g >= 1.5 && g <= 2.7) }' || OK=0
    fi
    PREV="$STAMP"
  done <<< "$LINES"
  VALUES="$(echo "$LINES" | awk '{ printf "%s ", $2 }')"
  if [ "$COUNT" -eq 3 ] && [ "$OK" -eq 1 ]; then
    result PASS "soil $SENSOR: ${VALUES}(gaps:${GAPS} s)"
  else
    result FAIL "soil $SENSOR: ${COUNT} messages '${VALUES}', gaps:${GAPS:- none} s (expected 3 whole numbers about 2 s apart)"
  fi
done

say ""
say "4. Pads (retained; empty means no tag)"
PAD_ERROR=0
for PAD in A B; do
  VALUE="$(mosquitto_sub -h "$HOST" -p "$PORT" -q 0 -t "incube/pad/$PAD" -C 1 -W 3 2>/dev/null)"
  CODE=$?
  if [ $CODE -eq 0 ] && [ -n "$VALUE" ]; then
    say "  pad $PAD: tag $VALUE"
  elif [ $CODE -eq 0 ] || [ $CODE -eq 27 ]; then
    say "  pad $PAD: empty (no tag stored on the broker)"
  else
    say "  pad $PAD: could not read (mosquitto_sub error $CODE)"
    PAD_ERROR=1
  fi
done
if [ $PAD_ERROR -eq 1 ]; then
  result FAIL "could not read the pad topics"
elif ask_yes "Do those match what is on the pads right now (a tag ID, or empty for no tag)?"; then
  result PASS "pads match"
else
  result FAIL "pads do not match. Check the readers and the serial log."
fi

say ""
say "5. Pump and safety (watch pump A)"
if ! ask_yes "Is pump A UNDER WATER with the grille fully covered, and you are watching it?"; then
  result SKIP "pump tests skipped: pump not under water"
else
  wait_seconds 35 "so pump A is idle and past any earlier 30 s gap"

  say "  Sending 'abc' to pump A while it is allowed to run (bad payload: must do nothing)."
  if pump A abc; then
    sleep 3
    if ask_yes "Did pump A stay OFF?"; then result PASS "bad payload ignored"; else result FAIL "bad payload ran the pump"; fi
  else
    result FAIL "bad payload could not be sent, so it was not tested"
  fi

  say "  Sending 800 to pump A, then 800 again 3 s later (the second must be refused: 30 s gap)."
  say "  Watch: it should run ONCE for under 1 s, then stay off."
  if pump A 800; then
    sleep 3
    if ! pump A 800; then
      result FAIL "second command could not be sent, so the gap rule was not tested"
    fi
    sleep 3
    if ask_yes "Did pump A run once for under 1 s and NOT start again?"; then
      result PASS "short run, then too-soon command refused"
    else
      result FAIL "run length or gap rule wrong (note what you saw)"
    fi
  else
    result FAIL "command could not be sent"
  fi

  wait_seconds 35 "for the 30 s gap to pass"
  say "  Sending 60000 to pump A (asks for 60 s; the firmware must cap it to 2 s). Time it."
  if pump A 60000; then
    if ask_yes "Did pump A run about 2 seconds and stop (not 60)?"; then result PASS "long command capped"; else result FAIL "long command NOT capped"; fi
  else
    result FAIL "command could not be sent"
  fi

  if ask_yes "Is pump B UNDER WATER with the grille covered, and do you want to test it?"; then
    if pump B 800 && ask_yes "Did pump B run under 1 second and stop?"; then result PASS "pump B short run"; else result FAIL "pump B did not run as expected"; fi
  else
    result SKIP "pump B not tested"
  fi
fi

say ""
say "6. Offline last will (broker should notice within about 23 s: 1.5 x the 15 s keepalive)"
if ask_yes "Unplug the ESP32's power NOW, then answer y once it is unplugged."; then
  START=$(date +%s)
  STATUS=""
  while [ $(( $(date +%s) - START )) -lt 40 ]; do
    STATUS="$(sub_one incube/status/esp32 2)"
    [ "$STATUS" = "offline" ] && break
    sleep 2
  done
  WAITED=$(( $(date +%s) - START ))
  if [ "$STATUS" = "offline" ]; then
    result PASS "offline seen after about ${WAITED}s"
  else
    result FAIL "no offline within ${WAITED} s (last seen '${STATUS:-nothing}')"
  fi
else
  result SKIP "offline test skipped"
fi

say ""
say "Done: $PASS passed, $FAIL failed, $SKIP skipped. Saved to $LOG"
[ "$FAIL" -eq 0 ]
