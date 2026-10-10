// firmware/incube_firmware/cube_network.h: Wi-Fi and MQTT interface. Owner: Role 1 (firmware).
// Named cube_network (not network) because the ESP32 core has its own Network.h, and macOS file
// names ignore case, so a local network.h would replace the core one and break the Wi-Fi library.
// Joins Wi-Fi, connects to the broker with a last will of "offline" (retained), publishes
// "online" (retained) on every connect, and subscribes to the command topics. Reconnects on its
// own. Uses a clean session, so the broker never replays old commands after a reconnect.

#ifndef INCUBE_CUBE_NETWORK_H
#define INCUBE_CUBE_NETWORK_H

#include <stdint.h>

// Called for every message on a subscribed topic. payload is NOT null-terminated.
typedef void (*CommandHandler)(const char *topic, const uint8_t *payload, unsigned int length);

// Call once in setup(). Starts Wi-Fi; the broker connection happens in networkLoop().
void networkBegin(CommandHandler handler);

// Call on every pass of loop(). Handles incoming messages and reconnects when needed.
// A broker connect attempt blocks loop() for a few seconds at most in normal cases (TCP connect
// plus waiting for the broker's reply), and a stalled write can block longer. The safety module's
// hardware cutoff stops pumps on time regardless.
void networkLoop();

// True when connected to the broker.
bool networkConnected();

// Publish a text payload. Returns false if not connected or the publish failed.
bool networkPublish(const char *topic, const char *payload, bool retained);

#endif
