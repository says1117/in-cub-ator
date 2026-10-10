// firmware/tests/host_safety/shim/Arduino.h: Minimal fake Arduino header for the host test. Owner: Role 1 (firmware).
#pragma once
#include <stdint.h>
#include <stddef.h>
#define LOW 0
#define HIGH 1
#define INPUT 1
#define OUTPUT 3
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
unsigned long millis();
