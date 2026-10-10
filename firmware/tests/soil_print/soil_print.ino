// firmware/tests/soil_print/soil_print.ino: Throwaway sketch: print raw soil sensor readings for pots A and B. Owner: Role 1 (firmware).
// Not project code. Open Serial Monitor at 115200 baud. Each line shows one raw ADC value (0 to 4095) per sensor.

const int SOIL_A_PIN = 34;  // ADC1, pot A
const int SOIL_B_PIN = 35;  // ADC1, pot B
const int SAMPLES = 8;      // readings averaged into each printed value
const int RELAY_PINS[] = {25, 26, 27};  // held HIGH (off, relay is active low) so nothing runs during this test

int readAveraged(int pin) {
  long total = 0;
  for (int i = 0; i < SAMPLES; i++) {
    total += analogRead(pin);
    delay(5);
  }
  return total / SAMPLES;
}

void setup() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(RELAY_PINS[i], HIGH);
    pinMode(RELAY_PINS[i], OUTPUT);
  }
  Serial.begin(115200);
  delay(1000);
  Serial.println("soil_print: A on GPIO 34, B on GPIO 35, relays held off");
}

void loop() {
  Serial.print("soil A: ");
  Serial.print(readAveraged(SOIL_A_PIN));
  Serial.print(" (");
  Serial.print(analogReadMilliVolts(SOIL_A_PIN));
  Serial.print(" mV)  soil B: ");
  Serial.print(readAveraged(SOIL_B_PIN));
  Serial.print(" (");
  Serial.print(analogReadMilliVolts(SOIL_B_PIN));
  Serial.println(" mV)");
  delay(500);
}
