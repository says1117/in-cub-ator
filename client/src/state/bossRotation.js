// This is presentation state only; plant care and battle calculations stay unchanged.
export const BOSS_ORDER = ["drought-chomper", "sporeling-trio"];
const STORAGE_KEY = "incubator.boss-rotation.v1";

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function createBossRotation(storage = browserStorage()) {
  let memory = { next: BOSS_ORDER[0], active: null };
  function read() {
    try {
      const stored = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
      if (stored && BOSS_ORDER.includes(stored.next)) {
        memory = { next: stored.next, active: stored.active &&
          BOSS_ORDER.includes(stored.active.id) && typeof stored.active.encounterId === "string"
          ? stored.active : null };
      }
    } catch { /* In-memory rotation works when browser storage is unavailable. */ }
    return memory;
  }
  function save(state) {
    memory = state;
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { storage = null; /* session fallback */ }
  }
  return {
    begin() {
      const state = read();
      if (!state.active) {
        save({ ...state, active: { id: state.next, encounterId: crypto.randomUUID() } });
      }
      return { ...memory.active };
    },
    complete(encounterId) {
      const state = read();
      if (!state.active || state.active.encounterId !== encounterId) return false;
      const next = BOSS_ORDER[(BOSS_ORDER.indexOf(state.active.id) + 1) % BOSS_ORDER.length];
      save({ next, active: null });
      return true;
    }
  };
}

export const bossRotation = createBossRotation();
