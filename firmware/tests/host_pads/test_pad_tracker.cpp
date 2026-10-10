// firmware/tests/host_pads/test_pad_tracker.cpp: Host unit test for the pad debounce logic and UID text. Owner: Role 1 (firmware).
// Run from the repo root:
//   clang++ -std=c++17 -Wall -Wextra -I firmware/incube_firmware firmware/tests/host_pads/test_pad_tracker.cpp firmware/incube_firmware/pad_tracker.cpp -o /tmp/test_pads && /tmp/test_pads

#include <cstdio>
#include <cstring>
#include "pad_tracker.h"

static int fails = 0, passes = 0;
#define CHECK(cond, msg) do { if (cond) { passes++; } else { fails++; printf("FAIL: %s (line %d)\n", msg, __LINE__); } } while (0)

static const char *T1 = "0450A901055713";
static const char *T2 = "0450AA01F25713";

int main() {
  PadTracker t;
  padTrackerReset(t);
  CHECK(t.reported[0] == '\0', "starts empty");

  CHECK(!padTrackerUpdate(t, true, T1, 2, 3), "first read of a tag not reported yet");
  CHECK(padTrackerUpdate(t, true, T1, 2, 3), "second matching read reports it");
  CHECK(strcmp(t.reported, T1) == 0, "reported UID");
  CHECK(!padTrackerUpdate(t, true, T1, 2, 3), "same tag again: no change");

  CHECK(!padTrackerUpdate(t, false, "", 2, 3), "one miss: no change");
  CHECK(!padTrackerUpdate(t, false, "", 2, 3), "two misses: no change");
  CHECK(!padTrackerUpdate(t, true, T1, 2, 3), "tag back before removal: no change");
  CHECK(!padTrackerUpdate(t, false, "", 2, 3), "miss count restarted (1)");
  CHECK(!padTrackerUpdate(t, false, "", 2, 3), "miss count restarted (2)");
  CHECK(padTrackerUpdate(t, false, "", 2, 3), "third miss in a row reports removal");
  CHECK(t.reported[0] == '\0', "reported empty");
  CHECK(!padTrackerUpdate(t, false, "", 2, 3), "still empty: no change");

  CHECK(!padTrackerUpdate(t, true, T1, 2, 3), "T1 once");
  CHECK(!padTrackerUpdate(t, true, T2, 2, 3), "then T2 once: candidate switches, nothing reported");
  CHECK(padTrackerUpdate(t, true, T2, 2, 3), "T2 twice: reported");
  CHECK(strcmp(t.reported, T2) == 0, "reported T2");

  CHECK(!padTrackerUpdate(t, true, T1, 2, 3), "swap to T1, first read");
  CHECK(padTrackerUpdate(t, true, T1, 2, 3), "swap to T1 reported directly, no removal in between");

  CHECK(!padTrackerUpdate(t, true, T2, 2, 3), "a single stray read of another tag");
  CHECK(!padTrackerUpdate(t, true, T1, 2, 3), "back to T1: still T1, no change");
  CHECK(strcmp(t.reported, T1) == 0, "stray read did not change anything");

  padTrackerReset(t);
  CHECK(!padTrackerUpdate(t, true, nullptr, 2, 3), "null UID treated as empty");
  CHECK(!padTrackerUpdate(t, true, "", 2, 3), "empty UID treated as empty");
  CHECK(padTrackerUpdate(t, true, T1, 0, 0) && strcmp(t.reported, T1) == 0, "limits below 1 behave as 1");

  char out[PAD_UID_TEXT_SIZE];
  unsigned char u1[7] = {0x04, 0x50, 0xA9, 0x01, 0x05, 0x57, 0x13};
  padUidToText(u1, 7, out); CHECK(strcmp(out, T1) == 0, "7-byte UID to text");
  unsigned char u2[4] = {0x0A, 0xB0, 0x00, 0xFF};
  padUidToText(u2, 4, out); CHECK(strcmp(out, "0AB000FF") == 0, "4-byte UID keeps leading zeros");
  padUidToText(u2, 0, out); CHECK(out[0] == '\0', "length 0 gives empty");
  unsigned char u10[11] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 0xAB, 0xCD};
  padUidToText(u10, 10, out); CHECK(strcmp(out, "010203040506070809AB") == 0, "10-byte UID fits");
  padUidToText(u10, 11, out); CHECK(out[0] == '\0', "length over 10 gives empty");

  printf("%d passed, %d failed\n", passes, fails);
  return fails ? 1 : 0;
}
