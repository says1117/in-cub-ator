// client/src/state/wsSource.js: Game state from the server over WebSocket. Owner: Role 3 (client, art, demo).
import { SERVER_WS_URL, RECONNECT_MS } from "../config.js";

// Connects to the game server and calls onState(state) for every message.
// Reconnects on its own. Returns { sendDemoBoss, isConnected }.
export function connectWsSource(onState, onConnection = () => {}) {
  let socket = null;

  function open() {
    socket = new WebSocket(SERVER_WS_URL);
    socket.onopen = () => onConnection(true);
    socket.onmessage = (event) => onState(JSON.parse(event.data));
    socket.onclose = () => {
      onConnection(false);
      setTimeout(open, RECONNECT_MS);
    };
  }
  open();

  return {
    sendDemoBoss() {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "demo_boss" }));
      }
    },
    isConnected: () => socket && socket.readyState === WebSocket.OPEN,
  };
}
