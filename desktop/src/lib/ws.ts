import type { GuiClientMessage, GuiServerMessage } from "./types";

const GUI_PORT = import.meta.env.VITE_GUI_PORT ?? "7878";
const WS_URL = `ws://127.0.0.1:${GUI_PORT}/ws`;

const RECONNECT_DELAY_MS = 500;

export type ConnectionStatus = "connecting" | "open" | "closed";

/**
 * Auto-reconnecting WebSocket client to the aimux GUI host. The host replays an
 * `init` (and the last render per tab) on every fresh connection, so a reconnect
 * transparently restores the screen.
 */
export class GuiSocket {
  private socket: WebSocket | null = null;
  private closed = false;

  constructor(
    private readonly onMessage: (message: GuiServerMessage) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  connect(): void {
    this.onStatus("connecting");
    const socket = new WebSocket(WS_URL);
    this.socket = socket;

    socket.onopen = () => this.onStatus("open");
    socket.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(event.data as string) as GuiServerMessage);
      } catch {
        // ignore malformed frames
      }
    };
    socket.onclose = () => {
      // A disposed/replaced socket must not clobber the live status.
      if (this.closed || this.socket !== socket) {
        return;
      }
      this.onStatus("closed");
      setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    };
    socket.onerror = () => socket.close();
  }

  send(message: GuiClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  dispose(): void {
    this.closed = true;
    this.socket?.close();
  }
}
