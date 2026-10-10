// firmware/incube_firmware/safety.h: Safety limits interface (bounded pump and light runs). Owner: Role 1 (firmware).
// Every pump and light command goes through here, never straight to relays. The limits live in config.h.
// Rules: OFF until a valid command arrives, payload must be a positive integer, each run is capped,
// a minimum gap is enforced after each run, a command while that channel runs is ignored, and runs
// end on their own in safetyLoop(). Nothing is queued or replayed.

#ifndef INCUBE_SAFETY_H
#define INCUBE_SAFETY_H

#include <stddef.h>
#include "relays.h"

enum SafetyResult : int {
  SAFETY_STARTED = 0,      // run started with the requested length
  SAFETY_STARTED_CAPPED,   // run started, but shortened to the configured maximum
  SAFETY_BAD_PAYLOAD,      // not a positive whole number (empty, zero, sign, letters, spaces, too big)
  SAFETY_BUSY,             // that channel is already running
  SAFETY_TOO_SOON,         // minimum gap since the last run has not passed yet
  SAFETY_NOT_READY         // relays not started, or an invalid channel
};

// Call once in setup(), after relaysBegin().
void safetyBegin();

// Call on every pass of loop(). Turns channels off when their run time is up.
// The longest delay between two calls is how late a pump can stop, so keep loop() fast.
void safetyLoop();

// Request a pump run. payload is the raw MQTT payload (milliseconds as text), not null-terminated.
SafetyResult safetyRequestPump(RelayChannel pump, const char *payload, size_t length);

// Request a light run. payload is the raw MQTT payload (minutes as text), not null-terminated.
SafetyResult safetyRequestLight(const char *payload, size_t length);

// Emergency stop: everything off now. Counts as the end of a run for the gap rule.
void safetyAllOff();

// Short text for Serial logs, for example "too soon".
const char *safetyResultName(SafetyResult result);

// Parse a positive whole number made only of digits 0-9. Exposed for tests.
bool safetyParsePositive(const char *payload, size_t length, unsigned long &value);

#endif
