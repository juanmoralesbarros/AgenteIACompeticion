export class ChatWebSocket {
  private socket: WebSocket | null = null;
  private url: string;
  private onMessageCallback: (msg: any) => void;
  private onOpenCallback?: () => void;

  constructor(
    url: string,
    onMessage: (msg: any) => void,
    onOpen?: () => void
  ) {
    this.url = url;
    this.onMessageCallback = onMessage;
    this.onOpenCallback = onOpen;
  }

  connect() {
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log("✅ WS conectado");
      if (this.onOpenCallback) this.onOpenCallback();
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessageCallback(data);
      } catch {
        this.onMessageCallback(event.data);
      }
    };

    this.socket.onerror = (err) => {
      console.error("❌ Error en WS:", err);
    };

    this.socket.onclose = () => {
      console.log("🔌 WS cerrado");
    };
  }

  send(message: string) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(message);
    }
  }
}
