export function skillPower(level, base) {
  return base + Math.max(0, Math.floor(Number(level) || 1) - 1);
}
