// firmware/tests/host_pads/test_pn532_frame.cpp: Host unit test for PN532 frame building and checking. Owner: Role 1 (firmware).
// Run from the repo root:
//   clang++ -std=c++17 -Wall -Wextra -I firmware/incube_firmware firmware/tests/host_pads/test_pn532_frame.cpp firmware/incube_firmware/pn532_frame.cpp -o /tmp/test_frame && /tmp/test_frame

#include <cstdio>
#include <cstring>
#include "pn532_frame.h"

static int fails = 0, passes = 0;
#define CHECK(cond, msg) do { if (cond) { passes++; } else { fails++; printf("FAIL: %s (line %d)\n", msg, __LINE__); } } while (0)

int main() {
  uint8_t out[PN532_MAX_FRAME_OUT];
  // GetFirmwareVersion: 00 00 FF 02 FE D4 02 2A 00 (known good frame from the PN532 manual)
  uint8_t fw[] = {0x02};
  size_t n = pn532BuildFrame(fw, 1, out);
  uint8_t fwExpected[] = {0x00, 0x00, 0xFF, 0x02, 0xFE, 0xD4, 0x02, 0x2A, 0x00};
  CHECK(n == sizeof(fwExpected) && memcmp(out, fwExpected, n) == 0, "GetFirmwareVersion frame");
  // SAMConfiguration 14 01 14 01: 00 00 FF 05 FB D4 14 01 14 01 02 00
  uint8_t sam[] = {0x14, 0x01, 0x14, 0x01};
  n = pn532BuildFrame(sam, 4, out);
  uint8_t samExpected[] = {0x00, 0x00, 0xFF, 0x05, 0xFB, 0xD4, 0x14, 0x01, 0x14, 0x01, 0x02, 0x00};
  CHECK(n == sizeof(samExpected) && memcmp(out, samExpected, n) == 0, "SAMConfiguration frame");
  CHECK(pn532BuildFrame(fw, 0, out) == 0, "empty command rejected");
  uint8_t big[PN532_MAX_COMMAND_DATA + 1] = {0};
  CHECK(pn532BuildFrame(big, sizeof(big), out) == 0, "too long rejected");

  uint8_t payload[40];
  size_t plen = 0;
  CHECK(pn532ParseFrame(PN532_ACK_FRAME, 6, payload, sizeof(payload), plen) == PN532_FRAME_ACK, "ACK recognised");
  uint8_t nack[] = {0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00};
  CHECK(pn532ParseFrame(nack, 6, payload, sizeof(payload), plen) == PN532_FRAME_BAD, "NACK is bad");
  uint8_t err[] = {0x00, 0x00, 0xFF, 0x01, 0xFF, 0x7F, 0x81, 0x00};
  CHECK(pn532ParseFrame(err, sizeof(err), payload, sizeof(payload), plen) == PN532_FRAME_ERROR, "error frame");
  uint8_t errBad[] = {0x00, 0x00, 0xFF, 0x01, 0xFF, 0x7F, 0x80, 0x00};
  CHECK(pn532ParseFrame(errBad, sizeof(errBad), payload, sizeof(payload), plen) == PN532_FRAME_BAD, "error frame with wrong checksum");
  CHECK(pn532ParseFrame(err, 6, payload, sizeof(payload), plen) == PN532_FRAME_BAD, "cut-off error frame");

  // Firmware answer: D5 03 32 01 06 07 -> DCS = 0x100 - (D5+03+32+01+06+07) & 0xFF
  uint8_t fwAnswer[] = {0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5, 0x03, 0x32, 0x01, 0x06, 0x07, 0xE8, 0x00};
  CHECK(pn532ParseFrame(fwAnswer, sizeof(fwAnswer), payload, sizeof(payload), plen) == PN532_FRAME_DATA, "firmware answer");
  CHECK(plen == 5 && payload[0] == 0x03 && payload[1] == 0x32, "firmware payload");
  uint8_t badSum[sizeof(fwAnswer)];
  memcpy(badSum, fwAnswer, sizeof(fwAnswer));
  badSum[11] ^= 0x01;
  CHECK(pn532ParseFrame(badSum, sizeof(badSum), payload, sizeof(payload), plen) == PN532_FRAME_BAD, "wrong data checksum");
  badSum[11] = fwAnswer[11];
  badSum[4] = 0xFB;
  CHECK(pn532ParseFrame(badSum, sizeof(badSum), payload, sizeof(payload), plen) == PN532_FRAME_BAD, "wrong length checksum");
  CHECK(pn532ParseFrame(fwAnswer, 8, payload, sizeof(payload), plen) == PN532_FRAME_BAD, "cut-off frame");
  CHECK(pn532ParseFrame(fwAnswer, sizeof(fwAnswer), payload, 3, plen) == PN532_FRAME_BAD, "payload buffer too small");
  uint8_t garbage[] = {0x01, 0x02, 0x03, 0x04, 0x05, 0x06};
  CHECK(pn532ParseFrame(garbage, sizeof(garbage), payload, sizeof(payload), plen) == PN532_FRAME_BAD, "garbage");
  CHECK(pn532ParseFrame(nullptr, 6, payload, sizeof(payload), plen) == PN532_FRAME_BAD, "null buffer");

  // Build a tag answer: 4B 01 01 00 44 00 07 <7-byte UID>
  uint8_t body[] = {0xD5, 0x4B, 0x01, 0x01, 0x00, 0x44, 0x00, 0x07, 0x04, 0x50, 0xA9, 0x01, 0x05, 0x57, 0x13};
  uint8_t tag[64];
  size_t t = 0;
  tag[t++] = 0x00; tag[t++] = 0x00; tag[t++] = 0xFF;
  tag[t++] = sizeof(body); tag[t++] = (uint8_t)(0x100 - sizeof(body));
  uint8_t sum = 0;
  for (size_t k = 0; k < sizeof(body); k++) { tag[t++] = body[k]; sum += body[k]; }
  tag[t++] = (uint8_t)(0x100 - sum); tag[t++] = 0x00;
  CHECK(pn532ParseFrame(tag, t, payload, sizeof(payload), plen) == PN532_FRAME_DATA, "tag answer frame");
  uint8_t uid[10];
  uint8_t ulen = pn532ExtractUid(payload, plen, uid);
  uint8_t expectUid[] = {0x04, 0x50, 0xA9, 0x01, 0x05, 0x57, 0x13};
  CHECK(ulen == 7 && memcmp(uid, expectUid, 7) == 0, "UID extracted");

  // A tag answer with card info (ATS) after a 7-byte UID: 42 frame bytes, must still parse.
  uint8_t atsBody[1 + 7 + 7 + 20];
  size_t ab = 0;
  atsBody[ab++] = 0xD5;
  uint8_t head[] = {0x4B, 0x01, 0x01, 0x03, 0x44, 0x20, 0x07, 0x04, 0x50, 0xA9, 0x01, 0x05, 0x57, 0x13};
  for (uint8_t v : head) atsBody[ab++] = v;
  while (ab < sizeof(atsBody)) atsBody[ab++] = 0x11;
  uint8_t ats[80];
  size_t a = 0;
  ats[a++] = 0x00; ats[a++] = 0x00; ats[a++] = 0xFF;
  ats[a++] = (uint8_t)ab; ats[a++] = (uint8_t)(0x100 - ab);
  uint8_t s2 = 0;
  for (size_t k = 0; k < ab; k++) { ats[a++] = atsBody[k]; s2 += atsBody[k]; }
  ats[a++] = (uint8_t)(0x100 - s2); ats[a++] = 0x00;
  uint8_t bigPayload[64];
  CHECK(a <= 64, "ATS answer fits the 64-byte read");
  CHECK(pn532ParseFrame(ats, a, bigPayload, sizeof(bigPayload), plen) == PN532_FRAME_DATA, "ATS answer parses");
  CHECK(pn532ExtractUid(bigPayload, plen, uid) == 7 && memcmp(uid, expectUid, 7) == 0, "UID from ATS answer");

  uint8_t none[] = {0x4B, 0x00};
  CHECK(pn532ExtractUid(none, 2, uid) == 0, "no tag found");
  uint8_t claimsTooLong[] = {0x4B, 0x01, 0x01, 0x00, 0x44, 0x00, 0x0B, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};
  CHECK(pn532ExtractUid(claimsTooLong, sizeof(claimsTooLong), uid) == 0, "UID over 10 bytes rejected");
  uint8_t claimsMore[] = {0x4B, 0x01, 0x01, 0x00, 0x44, 0x00, 0x07, 1, 2, 3};
  CHECK(pn532ExtractUid(claimsMore, sizeof(claimsMore), uid) == 0, "UID longer than the payload rejected");
  uint8_t wrongCode[] = {0x03, 0x01, 0x01, 0x00, 0x44, 0x00, 0x04, 1, 2, 3, 4};
  CHECK(pn532ExtractUid(wrongCode, sizeof(wrongCode), uid) == 0, "wrong answer code rejected");

  printf("%d passed, %d failed\n", passes, fails);
  return fails ? 1 : 0;
}
