// firmware/incube_firmware/pads.h: Tag pad reader interface. Owner: Role 1 (firmware).
// Two PN532 readers, one per pad, each on its own I2C bus. Reads without blocking: a search is
// started, later loop() passes check if the reader has answered, then the answer is collected.
// Answers are checked (checksum and length) by pn532_frame and debounced by pad_tracker.
// A reader that stops answering is told to abort and is restarted (there is no reset wire).
// If a reader stays stuck, only a power cycle (unplug USB for 5 seconds) clears it.

#ifndef INCUBE_PADS_H
#define INCUBE_PADS_H

#include "pad_tracker.h"

enum PadId : int {
  PAD_A = 0,
  PAD_B = 1,
  PAD_COUNT = 2
};

// Call once in setup(). Starts both buses and begins starting both readers (finished in padsLoop()).
void padsBegin();

// Call on every pass of loop(). Short I2C traffic only, no long waits.
void padsLoop();

// True when a pad's reported state changed. Fills pad and uidText ("" means the tag was lifted).
// Call repeatedly until it returns false, since both pads can change at once.
bool padsTakeChange(PadId &pad, char *uidText);

// Current reported state of one pad ("" means empty). For republishing after a reconnect.
const char *padsCurrent(PadId pad);

// True if that reader started and is answering.
bool padsReaderOk(PadId pad);

#endif
