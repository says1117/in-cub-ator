
import { fetchPlants } from "../services/api.js";

// Centralized plant state
let plants = [];

const listeners = new Set();

// Return all plants
export function getAllPlants() {
  return plants;
}

// Return one plant by ID
export function getPlantById(plantId) {
  return plants.find(
    plant => plant.plantId === plantId
  );
}

// Update plants and notify Phaser scenes
export function setPlants(newPlants) {
  if (!Array.isArray(newPlants)) {
    throw new Error("Plant data must be an array");
  }

  plants = newPlants;

  listeners.forEach(callback => {
    callback(plants);
  });
}

// Subscribe to plant updates
export function subscribe(callback) {
  listeners.add(callback);

  return () => {
    listeners.delete(callback);
  };
}

// Fetch plant data from FastAPI
export async function loadPlants() {
  try {
    const data = await fetchPlants();

    setPlants(data);

    console.log("Plants loaded from backend:", data);

    return data;
  } catch (error) {
    console.error("Failed to load plants:", error);
    throw error;
  }
}
