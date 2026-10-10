// firmware/incube_firmware/config.h: Pins and every tunable constant for the cube firmware. Owner: Role 1 (firmware).
// Change numbers here, not in the other files. Wi-Fi and broker address live in secrets.h, not here.

#ifndef INCUBE_CONFIG_H
#define INCUBE_CONFIG_H

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

const unsigned long PAD_POLL_INTERVAL_MS = 300;  // time between checks of one reader
const unsigned long PAD_READ_TIMEOUT_MS = 1000;  // how long one read may wait for a tag
const int PAD_CONFIRM_READS = 2;                 // same UID this many times in a row before reporting it
const int PAD_REMOVAL_MISSES = 3;                // empty reads in a row before reporting removal
const int PAD_START_ATTEMPTS = 5;                // reader start-up retries (no reset wire on the readers)
const unsigned long PAD_START_RETRY_MS = 200;
const unsigned long PAD_RESTART_AFTER_MS = 30000;  // retry a reader that never started

// ---------- Safety limits (enforced in safety.cpp, not by the game) ----------
// Starting values, TBD with Role 2. Keep them small until the pumps are proven.

const unsigned long PUMP_MAX_RUN_MS = 3000;     // longest single pump run
const unsigned long PUMP_MIN_GAP_MS = 30000;    // minimum time between runs of the same pump
const unsigned long LIGHT_MAX_MINUTES = 30;     // longest single light run
const unsigned long LIGHT_MIN_GAP_MS = 60000;   // minimum time between light runs

// ---------- Wi-Fi and MQTT ----------

const unsigned long WIFI_RETRY_MS = 5000;
const unsigned long MQTT_RETRY_MS = 5000;
const int MQTT_PORT = 1883;
const int MQTT_KEEPALIVE_S = 15;
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
