// firmware/incube_firmware/pad_tracker.h: Debounce logic for one NFC pad, kept apart from the reader hardware so it can be tested on a computer. Owner: Role 1 (firmware).
// A tag is reported only after the same UID is read confirmReads times in a row. Removal is
// reported only after removalMisses empty reads in a row. A failed read counts as an empty read,
// so a reader that dies with a tag on it eventually reports the pad as empty.

#ifndef INCUBE_PAD_TRACKER_H
#define INCUBE_PAD_TRACKER_H

const int PAD_UID_TEXT_SIZE = 21;  // up to 10 UID bytes as 20 hex characters, plus the end marker

struct PadTracker {
  char reported[PAD_UID_TEXT_SIZE];   // what the outside world was last told ("" = empty pad)
  char candidate[PAD_UID_TEXT_SIZE];  // UID being confirmed
  int confirmCount;
  int missCount;
};

// Start with an empty pad.
void padTrackerReset(PadTracker &tracker);

// Feed one read result. found is false for "no tag" and for a failed read.
// Returns true when the reported state changed; tracker.reported then holds the new state.
bool padTrackerUpdate(PadTracker &tracker, bool found, const char *uidText, int confirmReads, int removalMisses);

// Turn raw UID bytes into uppercase hex with no separators, for example "0450A901055713".
// Writes "" if length is 0 or more than 10.
void padUidToText(const unsigned char *uid, unsigned char length, char *out);

#endif
