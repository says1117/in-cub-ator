// client/src/config.js: Client tunables: server URL, mock toggle, timings. Owner: Role 3 (client, art, demo).
// The server runs on the machine that served this page (the Jetson, or this laptop in dev).
// `?ws=host:port` (or `?ws=port`) points the page at another server, for tests and offline runs.
const params = new URLSearchParams(window.location.search);

function serverUrl() {
  const override = params.get("ws");
  if (override) {
    if (/^\d+$/.test(override)) return `ws://${window.location.hostname || "localhost"}:${override}`;
    return override.startsWith("ws") ? override : `ws://${override}`;
  }
  return `ws://${window.location.hostname || "localhost"}:8765`;
}

export const SERVER_WS_URL = serverUrl();
export const RECONNECT_MS = 2000;
