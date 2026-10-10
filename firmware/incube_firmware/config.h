// firmware/incube_firmware/config.h: Pins and every tunable constant for the cube firmware. Owner: Role 1 (firmware).
// Change numbers here, not in the other files. Wi-Fi and broker address live in secrets.h, not here.

#ifndef INCUBE_CONFIG_H
#define INCUBE_CONFIG_H

#include <Arduino.h>  // for LOW and HIGH, so .cpp files can include this header on its own

// ---------- Pins (confirmed on the bench, see NOTES.md) ----------

// NFC readers (PN532 over I2C). Both boards use address 0x24, so each gets its own bus.
const int PAD_A_SDA = 21;  // Wire
const int PAD_A_SCL = 22;
const int PAD_B_SDA = 18;  // Wire1
const int PAD_B_SCL = 19;

// Soil sensors (ADC1 pins only, because ADC2 conflicts with Wi-Fi)
const int SOIL_A_PIN = 34;
const int SOIL_B_PIN = 35;

// Relay inputs. The relay is ACTIVE LOW: LOW turns a channel on, HIGH turns it off.
const int RELAY_PUMP_A_PIN = 25;  // IN1
const int RELAY_PUMP_B_PIN = 26;  // IN2
const int RELAY_LIGHT_PIN = 27;   // IN3
const int RELAY_ON = LOW;
const int RELAY_OFF = HIGH;

// ---------- Serial ----------

const unsigned long SERIAL_BAUD = 115200;

// ---------- Soil ----------

const int SOIL_SAMPLE_COUNT = 8;                      // readings averaged per published value
const unsigned long SOIL_SAMPLE_GAP_MS = 5;           // pause between samples
const int SOIL_OUTLIER_LIMIT = 400;                   // a sample this far from the median is ignored
const unsigned long SOIL_PUBLISH_INTERVAL_MS = 2000;  // TBD with the team
// Lower raw value means wetter. Provisional, measured in water (see calibration.md).
const int SOIL_DRY_THRESHOLD = 2800;  // above this: dry, summon the boss
const int SOIL_WET_THRESHOLD = 2000;  // below this: watered, dismiss the boss

// ---------- NFC pads ----------

const unsigned long PAD_POLL_INTERVAL_MS = 300;   // time between tag searches on one reader
const unsigned long PAD_READY_CHECK_MS = 5;       // how often to ask a busy reader "are you done?"
const unsigned long PAD_ACK_TIMEOUT_MS = 30;      // a command must be acknowledged within this
const unsigned long PAD_COMMAND_TIMEOUT_MS = 200; // set-up commands must answer within this
const unsigned long PAD_SEARCH_TIMEOUT_MS = 1500; // a tag search must answer within this (5 attempts took longer than 500 ms)
const int PAD_ACTIVATION_RETRIES = 5;             // how hard a search looks before answering "no tag" (tune on the bench)
const int PAD_CONFIRM_READS = 2;                  // same UID this many times in a row before reporting it
const int PAD_REMOVAL_MISSES = 3;                 // empty reads in a row before reporting removal
const int PAD_FAILS_BEFORE_DOWN = 3;              // failed commands in a row before a reader is restarted
const unsigned long PAD_RESTART_AFTER_MS = 5000;  // wait before restarting a reader that went down
const unsigned long PAD_I2C_TIMEOUT_MS = 20;      // longest single I2C transfer
// Reads never block loop(): each pass does at most one short I2C transfer per reader.

// ---------- Safety limits (enforced in safety.cpp, not by the game) ----------
// Starting values, TBD with Role 2. Keep them small until the pumps are proven.

const unsigned long PUMP_MAX_RUN_MS = 3000;     // longest single pump run
const unsigned long PUMP_MIN_GAP_MS = 30000;    // minimum time between runs of the same pump
const unsigned long LIGHT_MAX_MINUTES = 30;     // longest single light run
const unsigned long LIGHT_MIN_GAP_MS = 60000;   // minimum time between light runs

// Keep every duration positive and far below the 32-bit millis() range, so time math never overflows.
static_assert(PUMP_MAX_RUN_MS > 0 && PUMP_MAX_RUN_MS < 0x7FFFFFFFUL, "PUMP_MAX_RUN_MS out of range");
static_assert(PUMP_MIN_GAP_MS > 0 && PUMP_MIN_GAP_MS < 0x7FFFFFFFUL, "PUMP_MIN_GAP_MS out of range");
static_assert(LIGHT_MAX_MINUTES > 0 && LIGHT_MAX_MINUTES < 0x7FFFFFFFUL / 60000UL, "LIGHT_MAX_MINUTES out of range");
static_assert(LIGHT_MIN_GAP_MS > 0 && LIGHT_MIN_GAP_MS < 0x7FFFFFFFUL, "LIGHT_MIN_GAP_MS out of range");

// ---------- Wi-Fi and MQTT ----------

const unsigned long WIFI_RETRY_MS = 5000;       // how often to print the Wi-Fi status while not connected
const unsigned long WIFI_RECONNECT_MS = 30000;  // force a reconnect only this often; joining can take over 5 s
const unsigned long MQTT_RETRY_MS = 5000;
const int MQTT_PORT = 1883;
const int MQTT_KEEPALIVE_S = 15;
const int MQTT_SOCKET_TIMEOUT_S = 2;  // per-step network timeout; one connect attempt can take a few of these
const char MQTT_CLIENT_ID[] = "incube-esp32";

// Topics. Must match CONTRACT.md.
const char TOPIC_PAD_A[] = "incube/pad/A";
const char TOPIC_PAD_B[] = "incube/pad/B";
const char TOPIC_SOIL_A[] = "incube/soil/A";
const char TOPIC_SOIL_B[] = "incube/soil/B";
const char TOPIC_CMD_PUMP_A[] = "incube/cmd/pump/A";
const char TOPIC_CMD_PUMP_B[] = "incube/cmd/pump/B";
const char TOPIC_CMD_LIGHT[] = "incube/cmd/light";
const char TOPIC_STATUS[] = "incube/status/esp32";
const char STATUS_ONLINE[] = "online";
const char STATUS_OFFLINE[] = "offline";

#endif
