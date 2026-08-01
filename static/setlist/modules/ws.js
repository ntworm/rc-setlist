// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// WebSocket client module for Setlist UI (Task 6.4)

export class SetlistWSClient {
  constructor(options = {}) {
    this.url = options.url ?? `ws://${window.location.host}/ws`;
    this.ws = null;
    this.onMessage = options.onMessage ?? (() => {});
    this.onStatusChange = options.onStatusChange ?? (() => {});
    this.reconnectTimer = null;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
      this.onStatusChange("connecting");

      this.ws.onopen = () => {
        this.onStatusChange("connected");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.onMessage(data);
        } catch {}
      };

      this.ws.onclose = () => {
        this.onStatusChange("disconnected");
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.onStatusChange("error");
      };
    } catch {
      this.onStatusChange("disconnected");
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
