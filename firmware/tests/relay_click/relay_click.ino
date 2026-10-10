// firmware/tests/relay_click/relay_click.ino: Throwaway sketch: click each relay channel on for 1 second, one at a time. Owner: Role 1 (firmware).
// Not project code. The relay is ACTIVE LOW: LOW turns a channel on, HIGH turns it off.
// Channels: IN1 = GPIO 25 (pump A), IN2 = GPIO 26 (pump B), IN3 = GPIO 27 (grow light).
// Open Serial Monitor at 115200 baud.

const int RELAY_PINS[] = {25, 26, 27};
const char *RELAY_NAMES[] = {"IN1 pump A", "IN2 pump B", "IN3 grow light"};
const int RELAY_COUNT = 3;
const unsigned long ON_MS = 1000;   // how long each channel stays on
const unsigned long GAP_MS = 2000;  // pause between channels

void allOff() {
  for (int i = 0; i < RELAY_COUNT; i++) digitalWrite(RELAY_PINS[i], HIGH);
}

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < RELAY_COUNT; i++) {
    digitalWrite(RELAY_PINS[i], HIGH);  // set off before the pin becomes an output
    pinMode(RELAY_PINS[i], OUTPUT);
  }
  allOff();
  delay(1000);
  Serial.println("relay_click: starting in 3 seconds");
  delay(3000);
}

void loop() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    Serial.print(RELAY_NAMES[i]);
    Serial.println(" ON");
    digitalWrite(RELAY_PINS[i], LOW);
    delay(ON_MS);
    digitalWrite(RELAY_PINS[i], HIGH);
    Serial.print(RELAY_NAMES[i]);
    Serial.println(" OFF");
    delay(GAP_MS);
  }
  Serial.println("--- round done, repeating in 5 seconds ---");
  delay(5000);
}
