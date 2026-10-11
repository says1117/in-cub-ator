// client/src/state/wsSource.js: Game state from the server WebSocket. Owner: Role 3 (client, art, demo).
import { CONFIG } from "../config.js";

export function wsSource(onState, onStatus) {
  let ws, closed = false;
  function connect() {
    ws = new WebSocket(CONFIG.wsUrl);
    ws.onopen = () => onStatus(true);
    ws.onmessage = (e) => { try { onState(JSON.parse(e.data)); } catch (err) { /* ignore */ } };
    ws.onclose = () => { onStatus(false); if (!closed) setTimeout(connect, CONFIG.reconnectMs); };
    ws.onerror = () => ws.close();
  }
  connect();
  return { stop() { closed = true; ws && ws.close(); } };
}
