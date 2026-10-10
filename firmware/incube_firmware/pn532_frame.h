// firmware/incube_firmware/pn532_frame.h: Build and check PN532 message frames, with no hardware, so it can be tested on a computer. Owner: Role 1 (firmware).
// Frame to the PN532:   00 00 FF LEN LCS D4 <command> <data...> DCS 00
// Frame from the PN532: 00 00 FF LEN LCS D5 <command+1> <data...> DCS 00
// LCS makes LEN+LCS = 0 and DCS makes D4/D5 + all data + DCS = 0 (both modulo 256).
// Over I2C, every read from the PN532 starts with one status byte (0x01 = ready); strip it first.

#ifndef INCUBE_PN532_FRAME_H
#define INCUBE_PN532_FRAME_H

#include <stddef.h>
#include <stdint.h>

const uint8_t PN532_MAX_COMMAND_DATA = 16;
const size_t PN532_MAX_FRAME_OUT = PN532_MAX_COMMAND_DATA + 8;

enum Pn532Frame : int {
  PN532_FRAME_ACK = 0,  // "command received"
  PN532_FRAME_DATA,     // a valid answer; payload holds <command+1> <data...>
  PN532_FRAME_ERROR,    // the PN532 reported an application error
  PN532_FRAME_BAD       // anything else: NACK, wrong checksum, too short, too long, garbage
};

// Builds a frame for <command> <data...> (dataLength bytes in total, at most PN532_MAX_COMMAND_DATA).
// Returns the number of bytes written to out (out must hold PN532_MAX_FRAME_OUT), or 0 if too long.
size_t pn532BuildFrame(const uint8_t *data, uint8_t dataLength, uint8_t *out);

// The 6-byte ACK frame. Sending it to the PN532 aborts the command it is working on.
extern const uint8_t PN532_ACK_FRAME[6];

// Checks one frame read from the PN532 (status byte already removed). For a DATA frame, copies
// <command+1> <data...> into payload (at most payloadMax bytes) and sets payloadLength.
Pn532Frame pn532ParseFrame(const uint8_t *buffer, size_t length, uint8_t *payload, size_t payloadMax, size_t &payloadLength);

// Reads the tag UID from an InListPassiveTarget answer payload (starts with 0x4B).
// Returns the UID length (1 to 10), or 0 if no tag was found or the payload is malformed.
// uidOut must hold 10 bytes.
uint8_t pn532ExtractUid(const uint8_t *payload, size_t payloadLength, uint8_t *uidOut);

#endif
