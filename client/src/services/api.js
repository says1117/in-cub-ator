const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export async function fetchPlants() {
  const response = await fetch(`${API_URL}/api/plants`);

  if (!response.ok) {
    throw new Error(`Failed to fetch plants: ${response.status}`);
  }

  return await response.json();
}

export async function fetchPlantById(plantId) {
  const response = await fetch(
    `${API_URL}/api/plants/${encodeURIComponent(plantId)}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch plant: ${response.status}`);
  }

  return await response.json();
}

// The server owns the reward and emits plants_updated; do not update the store here.
async function sendWateringRequest(plantId, endpoint, payload) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        `${API_URL}/api/plants/${encodeURIComponent(plantId)}/${endpoint}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) }
      );
      if (response.ok) return await response.json();
      lastError = new Error(`Watering reward failed: ${response.status}`);
      if (response.status < 500) throw Object.assign(lastError, { retryable: false });
    } catch (error) {
      if (error.retryable === false) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export function requestWateringReward(plantId, battleId) {
  return sendWateringRequest(plantId, "watering-reward", { battleId });
}

export function requestManualWatering(plantId, requestId) {
  return sendWateringRequest(plantId, "water", { requestId });
}
