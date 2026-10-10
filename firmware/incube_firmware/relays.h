// firmware/incube_firmware/relays.h: Relay control interface. Owner: Role 1 (firmware).
// This layer only switches channels and remembers their state. It does not decide whether a
// pump is allowed to run: that is safety.cpp's job, and every command must go through it.

#ifndef INCUBE_RELAYS_H
#define INCUBE_RELAYS_H

enum RelayChannel : int {
  RELAY_PUMP_A = 0,
  RELAY_PUMP_B = 1,
  RELAY_LIGHT = 2,
  RELAY_CHANNEL_COUNT = 3
};

// Call first thing in setup(). Drives every channel OFF. Nothing else here works until it runs.
void relaysBegin();

// Switch one channel. Returns false (and does nothing) for an invalid channel or before relaysBegin().
// Switching a channel to the state it is already in changes nothing, including its timestamp.
bool relaySet(RelayChannel channel, bool on);

// True if the channel is currently switched on by this code.
bool relayIsOn(RelayChannel channel);

// millis() when the channel last turned on. Only meaningful while relayIsOn() is true.
// Compare with (millis() - relayOnSinceMs(ch)), which stays correct when millis() wraps.
unsigned long relayOnSinceMs(RelayChannel channel);

// Switch every channel off. Does nothing before relaysBegin().
void relaysAllOff();

// Short name for Serial logs, for example "pump A".
const char *relayName(RelayChannel channel);

#endif
