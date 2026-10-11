import { API_URL as API } from "../config.js";

export function connectGameSource(onState, onConnection) {
  let socket, timer, stopped = false;
  const url = new URL(API);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/game";
  url.search = "";
  function connect() {
    socket = new WebSocket(url);
    socket.onopen = () => onConnection(true);
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "game_updated") onState(message.state);
        if (message.type === "action_rejected") onState(null, message.reason);
      } catch (error) { console.error("Invalid game message", error); }
    };
    socket.onclose = () => {
      onConnection(false);
      if (!stopped) timer = setTimeout(connect, 2000);
    };
  }
  connect();
  return {
    send(action) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(action));
      return true;
    },
    stop() { stopped = true; clearTimeout(timer); socket?.close(); }
  };
}
