// firmware/incube_firmware/pad_tracker.cpp: Debounce logic for one NFC pad. Owner: Role 1 (firmware).

#include <string.h>
#include "pad_tracker.h"

namespace {

void copyText(char *dest, const char *src) {
  strncpy(dest, src, PAD_UID_TEXT_SIZE - 1);
  dest[PAD_UID_TEXT_SIZE - 1] = '\0';
}

}  // namespace

void padTrackerReset(PadTracker &tracker) {
  tracker.reported[0] = '\0';
  tracker.candidate[0] = '\0';
  tracker.confirmCount = 0;
  tracker.missCount = 0;
}

bool padTrackerUpdate(PadTracker &tracker, bool found, const char *uidText, int confirmReads, int removalMisses) {
  if (confirmReads < 1) confirmReads = 1;
  if (removalMisses < 1) removalMisses = 1;

  if (!found || uidText == nullptr || uidText[0] == '\0') {
    tracker.candidate[0] = '\0';
    tracker.confirmCount = 0;
    if (tracker.reported[0] == '\0') return false;  // already empty
    tracker.missCount++;
    if (tracker.missCount < removalMisses) return false;
    tracker.reported[0] = '\0';
    tracker.missCount = 0;
    return true;
  }

  tracker.missCount = 0;
  if (strcmp(uidText, tracker.reported) == 0) {
    tracker.candidate[0] = '\0';  // the reported tag is still there
    tracker.confirmCount = 0;
    return false;
  }
  if (strcmp(uidText, tracker.candidate) == 0) {
    tracker.confirmCount++;
  } else {
    copyText(tracker.candidate, uidText);
    tracker.confirmCount = 1;
  }
  if (tracker.confirmCount < confirmReads) return false;
  copyText(tracker.reported, tracker.candidate);
  tracker.candidate[0] = '\0';
  tracker.confirmCount = 0;
  return true;
}

void padUidToText(const unsigned char *uid, unsigned char length, char *out) {
  static const char HEX_DIGITS[] = "0123456789ABCDEF";
  if (uid == nullptr || length == 0 || length > 10) {
    out[0] = '\0';
    return;
  }
  for (unsigned char i = 0; i < length; i++) {
    out[i * 2] = HEX_DIGITS[(uid[i] >> 4) & 0x0F];
    out[i * 2 + 1] = HEX_DIGITS[uid[i] & 0x0F];
  }
  out[length * 2] = '\0';
}
