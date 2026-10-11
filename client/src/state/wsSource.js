// client/src/state/wsSource.js: Game state from the server over WebSocket. Owner: Role 3 (client, art, demo).
import { SERVER_WS_URL, RECONNECT_MS } from "../config.js";

// Connects to the game server and calls onState(state) for every message.
// Reconnects on its own. Returns { sendDemoBoss, isConnected }.
export function connectWsSource(onState, onConnection = () => {}) {
  let socket = null;
  let retry = null;

  function open() {
    const mine = new WebSocket(SERVER_WS_URL);
    socket = mine;
    // An old socket can still fire after a new one has replaced it: only the current one counts.
    mine.onopen = () => { if (socket === mine) onConnection(true); };
    mine.onmessage = (event) => {
      if (socket !== mine) return;
      let state;
      try { state = JSON.parse(event.data); } catch { return; }   // a broken message is skipped
      onState(state);
    };
    mine.onclose = () => {
      if (socket !== mine) return;
      onConnection(false);
      clearTimeout(retry);
      retry = setTimeout(open, RECONNECT_MS);
    };
  }
  open();

  return {
    sendDemoBoss() {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "demo_boss" }));
      }
    },
    // Test only (the server's --sim): lift plant "A" or "B" off the cube, or set it down again.
    sendSimPad(plant) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "sim_pad", plant }));
      }
    },
    // move is one of: attack, guard, special, skill
    sendMove(move) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "move", move }));
      }
    },
    isConnected: () => socket && socket.readyState === WebSocket.OPEN,
  };
}
