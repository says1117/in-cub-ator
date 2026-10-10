// firmware/incube_firmware/pn532_frame.cpp: Build and check PN532 message frames. Owner: Role 1 (firmware).

#include <string.h>
#include "pn532_frame.h"

const uint8_t PN532_ACK_FRAME[6] = {0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00};

namespace {

const uint8_t TFI_TO_PN532 = 0xD4;
const uint8_t TFI_FROM_PN532 = 0xD5;
const uint8_t INLIST_ANSWER = 0x4B;
const uint8_t MAX_UID_LENGTH = 10;

}  // namespace

size_t pn532BuildFrame(const uint8_t *data, uint8_t dataLength, uint8_t *out) {
  if (data == nullptr || out == nullptr || dataLength == 0 || dataLength > PN532_MAX_COMMAND_DATA) return 0;
  uint8_t len = dataLength + 1;  // TFI plus data
  size_t i = 0;
  out[i++] = 0x00;
  out[i++] = 0x00;
  out[i++] = 0xFF;
  out[i++] = len;
  out[i++] = (uint8_t)(0x100 - len);
  out[i++] = TFI_TO_PN532;
  uint8_t sum = TFI_TO_PN532;
  for (uint8_t k = 0; k < dataLength; k++) {
    out[i++] = data[k];
    sum += data[k];
  }
  out[i++] = (uint8_t)(0x100 - sum);
  out[i++] = 0x00;
  return i;
}

Pn532Frame pn532ParseFrame(const uint8_t *buffer, size_t length, uint8_t *payload, size_t payloadMax, size_t &payloadLength) {
  payloadLength = 0;
  if (buffer == nullptr) return PN532_FRAME_BAD;
  // Find the start code 00 FF, after any number of leading 00 bytes.
  size_t i = 0;
  while (i < length && buffer[i] == 0x00) i++;
  if (i == 0 || i >= length || buffer[i] != 0xFF) return PN532_FRAME_BAD;
  i++;  // i now points at LEN
  if (i + 1 >= length) return PN532_FRAME_BAD;
  uint8_t len = buffer[i];
  uint8_t lcs = buffer[i + 1];
  if (len == 0x00 && lcs == 0xFF) return PN532_FRAME_ACK;
  if (len == 0xFF && lcs == 0x00) return PN532_FRAME_BAD;  // NACK
  if ((uint8_t)(len + lcs) != 0) return PN532_FRAME_BAD;
  if (len == 0x01) {
    // Error frame: 00 00 FF 01 FF 7F 81 00. Needs both the 7F code and its checksum 81.
    if (i + 3 < length && buffer[i + 2] == 0x7F && (uint8_t)(buffer[i + 2] + buffer[i + 3]) == 0) return PN532_FRAME_ERROR;
    return PN532_FRAME_BAD;
  }
  if (len < 2) return PN532_FRAME_BAD;  // need TFI and a command code
  size_t dataStart = i + 2;             // TFI
  if (dataStart + len >= length) return PN532_FRAME_BAD;  // need len bytes plus DCS
  if (buffer[dataStart] != TFI_FROM_PN532) return PN532_FRAME_BAD;
  uint8_t sum = 0;
  for (size_t k = 0; k <= len; k++) sum += buffer[dataStart + k];  // TFI, data, DCS
  if (sum != 0) return PN532_FRAME_BAD;
  size_t count = len - 1;  // everything after the TFI
  if (payload == nullptr || count > payloadMax) return PN532_FRAME_BAD;
  memcpy(payload, buffer + dataStart + 1, count);
  payloadLength = count;
  return PN532_FRAME_DATA;
}

uint8_t pn532ExtractUid(const uint8_t *payload, size_t payloadLength, uint8_t *uidOut) {
  // 4B NbTg Tg SENS_RES(2) SEL_RES NFCIDLength NFCID...
  if (payload == nullptr || uidOut == nullptr || payloadLength < 2) return 0;
  if (payload[0] != INLIST_ANSWER || payload[1] != 1) return 0;
  if (payloadLength < 7) return 0;
  uint8_t idLength = payload[6];
  if (idLength == 0 || idLength > MAX_UID_LENGTH) return 0;
  if ((size_t)7 + idLength > payloadLength) return 0;
  memcpy(uidOut, payload + 7, idLength);
  return idLength;
}
