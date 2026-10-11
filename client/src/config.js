// client/src/config.js: Client tunables: server URL, mock toggle, timings. Owner: Role 3 (client, art, demo).
const params = new URLSearchParams(location.search);

export const CONFIG = {
  // ?mock=1 forces fake data (no server needed); ?mock=0 forces the real server.
  // Default: real server, falling back to mock if it cannot be reached.
  mock: params.get("mock"),
  // The page is served by the Jetson, so the WebSocket lives on the same host.
  wsUrl: params.get("ws") || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host || "localhost:8000"}/ws`,
  apiBase: params.get("api") || (location.host ? "" : "http://localhost:8000"),
  width: 640,
  height: 360,
  reconnectMs: 2000,
  mockFallbackMs: 4000,   // switch to mock if no server data arrives in this time
  walkSpeed: 40,          // pixels per second
};
