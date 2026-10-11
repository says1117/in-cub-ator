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
