// client/src/state/wsSource.js: Game state from the server over WebSocket. Owner: Role 3 (client, art, demo).
import { SERVER_WS_URL, RECONNECT_MS } from "../config.js";

// Connects to the game server and calls onState(state) for every message, onConnection(true/false)
// when the link comes and goes. Reconnects on its own. A message that is not valid JSON is ignored.
export function connectWsSource(onState, onConnection = () => {}) {
  let socket = null;

  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  function open() {
    socket = new WebSocket(SERVER_WS_URL);
    socket.onopen = () => onConnection(true);
    socket.onmessage = (event) => {
      let state;
      try {
        state = JSON.parse(event.data);
      } catch {
        return;
      }
      if (state && typeof state === "object") onState(state);
    };
    socket.onclose = () => {
      onConnection(false);
      setTimeout(open, RECONNECT_MS);
    };
  }
  open();

  return {
    sendDemoBoss: () => send({ action: "demo_boss" }),
    // move: attack, guard, special or skill. turn: the battle turn the player was looking at,
    // so a press meant for one boss sign never lands on the next. Returns false when offline.
    sendMove: (move, turn) => send(turn == null ? { action: "move", move } : { action: "move", move, turn }),
    isConnected: () => Boolean(socket && socket.readyState === WebSocket.OPEN),
  };
}
