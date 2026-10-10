
import { setPlants } from "../state/plantStore.js";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

let socket = null;
let reconnectTimer = null;
let stopped = false;

export function connectPlantSocket() {
  // Avoid duplicate connections
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
     socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  stopped = false;

  const url = new URL(API_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/plants";
  url.search = "";

  socket = new WebSocket(url.toString());

  socket.onopen = () => {
    console.log("Connected to Plant Care WebSocket");
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      if (
        message.type === "plants_updated" &&
        Array.isArray(message.plants)
      ) {
        setPlants(message.plants);
        console.log("Plant data updated automatically:", message.plants);
      }
    } catch (error) {
      console.error("Invalid WebSocket message:", error);
    }
  };

  socket.onclose = () => {
    socket = null;

    if (!stopped) {
      console.log("WebSocket disconnected. Reconnecting...");

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectPlantSocket();
      }, 2000);
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

export function disconnectPlantSocket() {
  stopped = true;

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    const oldSocket = socket;
    socket = null;
    oldSocket.close();
  }
}
