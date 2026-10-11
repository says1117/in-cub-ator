// client/src/state/plantFeed.js: Fills the plant store the Storage screens read from.
// Role 3's Storage screens were built for a separate plant-care server. We do not run that one,
// so the plant list starts from the same two example plants it seeded, and the soil readings and
// health are overlaid from the game server's snapshot (pad A is the Cast Iron plant, pad B the Monstera).
// soilMoisture is the live sensor reading (null, shown as "--", until the first one arrives).
import { setPlants } from "./plantStore.js";

const SEED = [
  { plantId: "PLANT_001", nfcTagId: "NFC_A123", species: "Cast Iron Plant", soilMoisture: 70, lightIntensity: 800, co2: 40, level: 5, hp: 90 },
  { plantId: "PLANT_002", nfcTagId: "NFC_B456", species: "Monstera deliciosa", soilMoisture: 70, lightIntensity: 1200, co2: 40, level: 3, hp: 95 },
];
const PAD_OF = { PLANT_001: "A", PLANT_002: "B" };

export function feedPlants(state) {
  // "soil" has every plant's reading, on its pad or not. Older servers only sent meters.water.
  const soilOf = (state && state.soil) || (state && state.meters && state.meters.water) || {};
  const stale = Boolean(state && state.meters && state.meters.stale);
  const thirsty = (state && state.thirsty) || {};
  const health = state && typeof state.health === "number" ? Math.round(state.health) : null;
  setPlants(SEED.map((plant) => {
    const pad = PAD_OF[plant.plantId];
    const soil = soilOf[pad];
    return {
      ...plant,
      soilMoisture: typeof soil === "number" && !stale ? Math.round(soil) : null,
      thirsty: Boolean(thirsty[pad]),
      hp: health === null ? plant.hp : health,
    };
  }));
}
