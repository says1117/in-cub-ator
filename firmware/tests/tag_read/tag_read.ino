// firmware/tests/tag_read/tag_read.ino: Throwaway sketch: read tag UIDs from both pads and print them. Owner: Role 1 (firmware).
// Not project code. Hold a tag on a reader and its UID prints. Open Serial Monitor at 115200 baud.

#include <Wire.h>
#include <Adafruit_PN532.h>

const int BUS_A_SDA = 21;  // Reader A, Wire
const int BUS_A_SCL = 22;
const int BUS_B_SDA = 18;  // Reader B, Wire1
const int BUS_B_SCL = 19;

// 255 = pin not used. We poll over I2C, so the IRQ and reset pins are not wired.
Adafruit_PN532 readerA(255, 255, &Wire);
Adafruit_PN532 readerB(255, 255, &Wire1);

bool readerAReady = false;
bool readerBReady = false;

bool startReader(Adafruit_PN532 &reader, const char *name) {
  reader.begin();
  uint32_t version = reader.getFirmwareVersion();
  if (!version) {
    Serial.print(name);
    Serial.println(": PN532 not responding, will not be polled");
    return false;
  }
  if (!reader.SAMConfig()) {  // put the chip in normal card-reading mode
    Serial.print(name);
    Serial.println(": PN532 setup (SAMConfig) failed, will not be polled");
    return false;
  }
  reader.setPassiveActivationRetries(5);  // stop searching after 5 tries instead of forever
  Serial.print(name);
  Serial.print(": PN532 ready, firmware ");
  Serial.print((version >> 16) & 0xFF);
  Serial.print(".");
  Serial.println((version >> 8) & 0xFF);
  return true;
}

void checkReader(Adafruit_PN532 &reader, const char *name) {
  uint8_t uid[7];
  uint8_t uidLength = 0;
  bool found = reader.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 300);
  Serial.print(name);
  if (found) {
    Serial.print(": tag UID ");
    for (uint8_t i = 0; i < uidLength; i++) {
      if (uid[i] < 16) Serial.print("0");
      Serial.print(uid[i], HEX);
    }
    Serial.println();
  } else {
    Serial.println(": no tag");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Wire.begin(BUS_A_SDA, BUS_A_SCL);
  Wire1.begin(BUS_B_SDA, BUS_B_SCL);
  readerAReady = startReader(readerA, "A");
  readerBReady = startReader(readerB, "B");
}

void loop() {
  if (readerAReady) checkReader(readerA, "A");
  if (readerBReady) checkReader(readerB, "B");
  delay(500);
}
