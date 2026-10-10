// firmware/incube_firmware/incube_firmware.ino: Real sketch entry point: setup() and loop(). Owner: Role 1 (firmware).
// Wires the modules together. No logic of its own beyond routing.
// Needs secrets.h in this folder (copy secrets.h.example and fill it in; it is gitignored).

#include "config.h"
#include "relays.h"
#include "safety.h"
#include "soil.h"
#include "pads.h"
#include "cube_network.h"

namespace {

void logResult(const char *what, SafetyResult result) {
  Serial.print("command ");
  Serial.print(what);
  Serial.print(": ");
  Serial.println(safetyResultName(result));
}

void onCommand(const char *topic, const uint8_t *payload, unsigned int length) {
  const char *text = (const char *)payload;
  if (strcmp(topic, TOPIC_CMD_PUMP_A) == 0) {
    logResult("pump A", safetyRequestPump(RELAY_PUMP_A, text, length));
  } else if (strcmp(topic, TOPIC_CMD_PUMP_B) == 0) {
    logResult("pump B", safetyRequestPump(RELAY_PUMP_B, text, length));
  } else if (strcmp(topic, TOPIC_CMD_LIGHT) == 0) {
    logResult("light", safetyRequestLight(text, length));
  }
}

void publishSoil() {
  int a = 0, b = 0;
  if (!soilTakeReading(a, b)) return;
  char text[8];
  snprintf(text, sizeof(text), "%d", a);
  networkPublish(TOPIC_SOIL_A, text, false);
  snprintf(text, sizeof(text), "%d", b);
  networkPublish(TOPIC_SOIL_B, text, false);
}

const char *padTopic(PadId pad) {
  return pad == PAD_A ? TOPIC_PAD_A : TOPIC_PAD_B;
}

// Pad state is retained, so a restarted server learns what is on each pad.
// An empty retained message clears it, which the contract defines as "pad empty".
// A pad stays pending until its publish succeeds, so a failed send is retried.
bool padPending[PAD_COUNT] = {false, false};

void publishPads() {
  PadId pad;
  char uidText[PAD_UID_TEXT_SIZE];
  while (padsTakeChange(pad, uidText)) padPending[pad] = true;
  if (networkTakeJustConnected()) {
    // Changes while offline were never sent, so resend both pads after every (re)connect.
    padPending[PAD_A] = true;
    padPending[PAD_B] = true;
  }
  if (!networkConnected()) return;
  for (int i = 0; i < PAD_COUNT; i++) {
    if (!padPending[i]) continue;
    const char *state = padsCurrent((PadId)i);
    if (!networkPublish(padTopic((PadId)i), state, true)) continue;  // try again next pass
    padPending[i] = false;
    Serial.print("pad ");
    Serial.print(i == PAD_A ? "A" : "B");
    Serial.print(": ");
    Serial.println(state[0] == '\0' ? "(empty)" : state);
  }
}

}  // namespace

void setup() {
  relaysBegin();  // first: every channel OFF before anything else runs
  safetyBegin();
  Serial.begin(SERIAL_BAUD);
  Serial.println("incube_firmware: starting, all relays OFF");
  soilBegin();
  padsBegin();
  networkBegin(onCommand);
}

void loop() {
  safetyLoop();
  soilLoop();
  networkLoop();
  safetyLoop();  // again after the network, which can block briefly while connecting
  padsLoop();
  publishPads();
  publishSoil();
}
