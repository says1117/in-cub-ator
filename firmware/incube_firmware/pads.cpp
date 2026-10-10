// firmware/incube_firmware/pads.cpp: Tag pad reader implementation. Owner: Role 1 (firmware).
// Talks to the PN532 directly over I2C instead of through the Adafruit library, because the
// library waits for each answer (blocking loop()) and copies tag IDs without checking their length.
// Each reader runs a small step-by-step machine. One pass of padsLoop() does at most one short
// I2C transfer per reader (an abort, a command, or one read), so nothing here holds up the pumps,
// soil readings or Wi-Fi.

#include <Arduino.h>
#include <Wire.h>
#include "config.h"
#include "pn532_frame.h"
#include "pads.h"

namespace {

const uint8_t PN532_ADDRESS = 0x24;
const uint8_t PN532_READY = 0x01;
const size_t ACK_READ_BYTES = 1 + 6;      // status byte plus the ACK frame
const size_t ANSWER_READ_BYTES = 1 + 64;  // status byte plus a tag answer with a 10-byte UID and card info (ATS)

// Commands (first byte is the PN532 command code).
const uint8_t CMD_GET_FIRMWARE[] = {0x02};
const uint8_t CMD_SAM_NORMAL[] = {0x14, 0x01, 0x14, 0x01};  // normal mode, 1 s timeout, use IRQ
const uint8_t CMD_IN_LIST_ONE_A[] = {0x4A, 0x01, 0x00};     // look for 1 tag, type A (106 kbps)

enum Step {
  STEP_DOWN,        // waiting to restart
  STEP_GET_FIRMWARE,
  STEP_SAM,
  STEP_RETRIES,
  STEP_IDLE,        // ready, waiting for the next search
  STEP_SEARCH
};

enum Wait { WAIT_NONE, WAIT_ACK, WAIT_ANSWER };

struct Reader {
  const char *name;
  TwoWire *bus;
  Step step;
  Wait wait;
  bool needsAbort;             // send the abort frame on the next pass
  bool needsSend;              // send the command for the current step on the next pass
  uint8_t expectedAnswer;      // command code + 1
  unsigned long waitStartMs;
  unsigned long waitLimitMs;
  unsigned long lastCheckMs;
  unsigned long lastSearchMs;
  unsigned long downSinceMs;
  unsigned long lastDownMissMs;
  int failCount;
  PadTracker tracker;
  bool dirty;                  // reported state not yet handed to the main sketch
};

Reader readers[PAD_COUNT] = {
  {"A", &Wire, STEP_DOWN, WAIT_NONE, false, false, 0, 0, 0, 0, 0, 0, 0, 0, {}, false},
  {"B", &Wire1, STEP_DOWN, WAIT_NONE, false, false, 0, 0, 0, 0, 0, 0, 0, 0, {}, false},
};

void feed(Reader &r, bool found, const char *uidText) {
  if (padTrackerUpdate(r.tracker, found, uidText, PAD_CONFIRM_READS, PAD_REMOVAL_MISSES)) r.dirty = true;
}

bool writeBytes(Reader &r, const uint8_t *data, size_t length) {
  r.bus->beginTransmission(PN532_ADDRESS);
  r.bus->write(data, length);
  return r.bus->endTransmission() == 0;
}

// Reads count bytes in one transfer. Returns true only if the first (status) byte says ready.
bool readIfReady(Reader &r, uint8_t *buffer, size_t count) {
  size_t got = r.bus->requestFrom(PN532_ADDRESS, (uint8_t)count);
  if (got != count) {
    while (r.bus->available()) r.bus->read();
    return false;
  }
  for (size_t i = 0; i < count; i++) buffer[i] = r.bus->read();
  return (buffer[0] & PN532_READY) != 0;  // bit 0 is the ready flag, the other bits are reserved
}

// Tells the PN532 to drop whatever it was doing. Safe to send at any time.
bool abortCommand(Reader &r) {
  return writeBytes(r, PN532_ACK_FRAME, sizeof(PN532_ACK_FRAME));
}

bool sendCommand(Reader &r, const uint8_t *data, uint8_t length, unsigned long limitMs, unsigned long now) {
  uint8_t frame[PN532_MAX_FRAME_OUT];
  size_t frameLength = pn532BuildFrame(data, length, frame);
  if (frameLength == 0 || !writeBytes(r, frame, frameLength)) return false;
  r.wait = WAIT_ACK;
  r.expectedAnswer = data[0] + 1;
  r.waitStartMs = now;
  r.waitLimitMs = limitMs;
  r.lastCheckMs = now;
  return true;
}

// Only changes state. Callers have already scheduled the abort and fed any empty read.
void enterDown(Reader &r, unsigned long now, const char *why) {
  r.step = STEP_DOWN;
  r.wait = WAIT_NONE;
  r.needsSend = false;
  r.downSinceMs = now;
  r.lastDownMissMs = now;
  r.failCount = 0;
  Serial.print("pads: reader ");
  Serial.print(r.name);
  Serial.print(" down (");
  Serial.print(why);
  Serial.println("), will restart");
}

// The one place a failed command is handled: schedule one abort, feed at most one empty read.
// Set-up failures restart the reader. Search failures count as an empty read, and several in a
// row restart the reader.
void commandFailed(Reader &r, unsigned long now, const char *why) {
  r.wait = WAIT_NONE;
  r.needsSend = false;
  r.needsAbort = true;
  if (r.step != STEP_SEARCH) {
    enterDown(r, now, why);
    return;
  }
  feed(r, false, "");
  r.step = STEP_IDLE;
  r.failCount++;
  if (r.failCount >= PAD_FAILS_BEFORE_DOWN) enterDown(r, now, why);
}

// Moves to a step whose command is sent on the next pass.
void scheduleStep(Reader &r, Step step) {
  r.step = step;
  r.needsSend = true;
}

void sendStepCommand(Reader &r, unsigned long now) {
  r.needsSend = false;
  bool ok = true;
  switch (r.step) {
    case STEP_GET_FIRMWARE:
      ok = sendCommand(r, CMD_GET_FIRMWARE, sizeof(CMD_GET_FIRMWARE), PAD_COMMAND_TIMEOUT_MS, now);
      break;
    case STEP_SAM:
      ok = sendCommand(r, CMD_SAM_NORMAL, sizeof(CMD_SAM_NORMAL), PAD_COMMAND_TIMEOUT_MS, now);
      break;
    case STEP_RETRIES: {
      // RFConfiguration item 5: retries for ATR, PSL and passive activation (tag search).
      uint8_t cmd[] = {0x32, 0x05, 0xFF, 0x01, (uint8_t)PAD_ACTIVATION_RETRIES};
      ok = sendCommand(r, cmd, sizeof(cmd), PAD_COMMAND_TIMEOUT_MS, now);
      break;
    }
    case STEP_SEARCH:
      r.lastSearchMs = now;
      ok = sendCommand(r, CMD_IN_LIST_ONE_A, sizeof(CMD_IN_LIST_ONE_A), PAD_SEARCH_TIMEOUT_MS, now);
      break;
    default:
      return;
  }
  if (!ok) commandFailed(r, now, "write failed");
}

// A valid answer arrived for the current step.
void handleAnswer(Reader &r, const uint8_t *payload, size_t length, unsigned long now) {
  switch (r.step) {
    case STEP_GET_FIRMWARE:
      // 03 IC Ver Rev Support; the PN532 reports IC 0x32.
      if (length < 5 || payload[1] != 0x32) {
        commandFailed(r, now, "not a PN532");
        return;
      }
      scheduleStep(r, STEP_SAM);
      return;
    case STEP_SAM:
      scheduleStep(r, STEP_RETRIES);
      return;
    case STEP_RETRIES:
      r.step = STEP_IDLE;
      r.failCount = 0;
      Serial.print("pads: reader ");
      Serial.print(r.name);
      Serial.println(" ready");
      return;
    case STEP_SEARCH: {
      uint8_t uid[10];
      uint8_t uidLength = pn532ExtractUid(payload, length, uid);
      char text[PAD_UID_TEXT_SIZE];
      if (uidLength > 0) padUidToText(uid, uidLength, text); else text[0] = '\0';
      feed(r, text[0] != '\0', text);
      r.failCount = 0;
      r.step = STEP_IDLE;
      return;
    }
    default:
      return;
  }
}

// Checks a reader that is waiting for an ACK or an answer. One read at most. A reply that has
// already arrived is accepted even if this pass came late, before the timeout is applied.
void checkWait(Reader &r, unsigned long now) {
  unsigned long limit = (r.wait == WAIT_ACK) ? PAD_ACK_TIMEOUT_MS : r.waitLimitMs;
  bool timedOut = (now - r.waitStartMs) >= limit;
  if (!timedOut && (now - r.lastCheckMs) < PAD_READY_CHECK_MS) return;
  r.lastCheckMs = now;

  uint8_t buffer[ANSWER_READ_BYTES];
  size_t count = (r.wait == WAIT_ACK) ? ACK_READ_BYTES : ANSWER_READ_BYTES;
  if (!readIfReady(r, buffer, count)) {
    if (timedOut) commandFailed(r, now, r.wait == WAIT_ACK ? "no ACK" : "no answer");
    return;
  }

  uint8_t payload[ANSWER_READ_BYTES];
  size_t payloadLength = 0;
  Pn532Frame kind = pn532ParseFrame(buffer + 1, count - 1, payload, sizeof(payload), payloadLength);
  if (r.wait == WAIT_ACK) {
    if (kind != PN532_FRAME_ACK) {
      commandFailed(r, now, "bad ACK");
      return;
    }
    r.wait = WAIT_ANSWER;
    r.waitStartMs = now;
    return;
  }
  r.wait = WAIT_NONE;
  if (kind != PN532_FRAME_DATA || payloadLength == 0 || payload[0] != r.expectedAnswer) {
    commandFailed(r, now, kind == PN532_FRAME_ERROR ? "reader error" : "bad answer");
    return;
  }
  handleAnswer(r, payload, payloadLength, now);
}

void serviceReader(Reader &r, unsigned long now) {
  // At most one I2C transfer per pass, in this order.
  if (r.needsAbort) {
    r.needsAbort = false;
    if (!abortCommand(r)) {
      // The reader is not answering at all. Go (or stay) down; every restart begins with a
      // fresh abort, so the lost abort is retried then and no command is sent before it.
      if (r.step != STEP_DOWN) {
        enterDown(r, now, "abort failed");
      } else {
        r.needsSend = false;
        r.downSinceMs = now;
      }
    }
    return;
  }
  if (r.needsSend) {
    sendStepCommand(r, now);
    return;
  }
  if (r.wait != WAIT_NONE) {
    checkWait(r, now);
    return;
  }
  switch (r.step) {
    case STEP_DOWN:
      // While down, keep counting empty reads so a tag that was on it is reported lifted.
      if ((now - r.lastDownMissMs) >= PAD_POLL_INTERVAL_MS) {
        r.lastDownMissMs = now;
        feed(r, false, "");
      }
      if ((now - r.downSinceMs) >= PAD_RESTART_AFTER_MS) {
        r.needsAbort = true;  // clear anything left over, then start again
        scheduleStep(r, STEP_GET_FIRMWARE);
      }
      return;
    case STEP_IDLE:
      if ((now - r.lastSearchMs) >= PAD_POLL_INTERVAL_MS) scheduleStep(r, STEP_SEARCH);
      return;
    default:
      return;
  }
}

}  // namespace

void padsBegin() {
  Wire.begin(PAD_A_SDA, PAD_A_SCL);
  Wire1.begin(PAD_B_SDA, PAD_B_SCL);
  Wire.setTimeOut(PAD_I2C_TIMEOUT_MS);
  Wire1.setTimeOut(PAD_I2C_TIMEOUT_MS);
  unsigned long now = millis();
  for (int i = 0; i < PAD_COUNT; i++) {
    Reader &r = readers[i];
    padTrackerReset(r.tracker);
    r.dirty = false;
    r.failCount = 0;
    r.lastSearchMs = now;
    r.wait = WAIT_NONE;
    r.needsAbort = true;  // the reader may still be busy from before the ESP32 restarted
    scheduleStep(r, STEP_GET_FIRMWARE);
  }
}

void padsLoop() {
  unsigned long now = millis();
  for (int i = 0; i < PAD_COUNT; i++) serviceReader(readers[i], now);
}

bool padsTakeChange(PadId &pad, char *uidText) {
  for (int i = 0; i < PAD_COUNT; i++) {
    if (!readers[i].dirty) continue;
    readers[i].dirty = false;
    pad = (PadId)i;
    strncpy(uidText, readers[i].tracker.reported, PAD_UID_TEXT_SIZE - 1);
    uidText[PAD_UID_TEXT_SIZE - 1] = '\0';
    return true;
  }
  return false;
}

const char *padsCurrent(PadId pad) {
  if (pad < 0 || pad >= PAD_COUNT) return "";
  return readers[pad].tracker.reported;
}

bool padsReaderOk(PadId pad) {
  if (pad < 0 || pad >= PAD_COUNT) return false;
  return readers[pad].step != STEP_DOWN;
}
