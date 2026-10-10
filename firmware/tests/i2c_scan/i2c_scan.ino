// firmware/tests/i2c_scan/i2c_scan.ino: Throwaway sketch: scan both I2C buses and print found addresses. Owner: Role 1 (firmware).
// Not project code. Expect a PN532 at 0x24 on whichever bus it is plugged into.
// Open Serial Monitor at 115200 baud.

#include <Wire.h>

const int BUS_A_SDA = 21;  // Reader A, Wire
const int BUS_A_SCL = 22;
const int BUS_B_SDA = 18;  // Reader B, Wire1
const int BUS_B_SCL = 19;

void scanBus(TwoWire &bus, const char *name) {
  Serial.print("Scanning ");
  Serial.println(name);
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    bus.beginTransmission(addr);
    if (bus.endTransmission() == 0) {
      Serial.print("  found device at 0x");
      if (addr < 16) Serial.print("0");
      Serial.println(addr, HEX);
      found++;
    }
  }
  if (found == 0) Serial.println("  nothing found");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Wire.begin(BUS_A_SDA, BUS_A_SCL);
  Wire1.begin(BUS_B_SDA, BUS_B_SCL);
}

void loop() {
  scanBus(Wire, "Wire (reader A, SDA 21, SCL 22)");
  scanBus(Wire1, "Wire1 (reader B, SDA 18, SCL 19)");
  Serial.println("---");
  delay(3000);
}
