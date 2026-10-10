// client/src/config.js: Client tunables: server URL, mock toggle, timings. Owner: Role 3 (client, art, demo).
// The server runs on the machine that served this page (the Jetson, or this laptop in dev).
export const SERVER_WS_URL = `ws://${window.location.hostname || "localhost"}:8765`;
export const RECONNECT_MS = 2000;
