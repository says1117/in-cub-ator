// firmware/tests/relay_test/relay_test.ino: Throwaway sketch: test each relay channel once, then stop with everything off. Owner: Role 1 (firmware).
// Not project code. The relay is ACTIVE LOW: LOW turns a channel on, HIGH turns it off.
// Open Serial Monitor at 115200 baud.

const int PIN_IN1 = 25;  // pump A
const int PIN_IN2 = 26;  // pump B
const int PIN_IN3 = 27;  // grow light (IN4 is unused)

const int CHANNEL_COUNT = 3;
const int CHANNEL_PINS[CHANNEL_COUNT] = {PIN_IN1, PIN_IN2, PIN_IN3};
const char *CHANNEL_NAMES[CHANNEL_COUNT] = {"pump A", "pump B", "grow light"};

const int RELAY_ON = LOW;
const int RELAY_OFF = HIGH;

const unsigned long START_DELAY_MS = 3000;  // wait before the first channel
const unsigned long ON_TIME_MS = 2000;      // each channel stays on this long
const unsigned long OFF_TIME_MS = 3000;     // pause after each channel

void allOff() {
  for (int i = 0; i < CHANNEL_COUNT; i++) {
    digitalWrite(CHANNEL_PINS[i], RELAY_OFF);
  }
}

void setup() {
  // Write HIGH first so the pin never pulses LOW when it becomes an output.
  for (int i = 0; i < CHANNEL_COUNT; i++) {
    digitalWrite(CHANNEL_PINS[i], RELAY_OFF);
    pinMode(CHANNEL_PINS[i], OUTPUT);
  }
  allOff();

  Serial.begin(115200);
  Serial.println("relay_test: all channels OFF, starting in 3 seconds");
  delay(START_DELAY_MS);

  for (int i = 0; i < CHANNEL_COUNT; i++) {
    Serial.print("Channel ");
    Serial.print(i + 1);
    Serial.print(" (");
    Serial.print(CHANNEL_NAMES[i]);
    Serial.println(") ON");
    digitalWrite(CHANNEL_PINS[i], RELAY_ON);
    delay(ON_TIME_MS);

    digitalWrite(CHANNEL_PINS[i], RELAY_OFF);
    Serial.print("Channel ");
    Serial.print(i + 1);
    Serial.println(" OFF");
    delay(OFF_TIME_MS);
  }

  allOff();
  Serial.println("relay_test: done, all channels OFF");
}

void loop() {
  // Nothing to do. The sequence runs once in setup().
}
