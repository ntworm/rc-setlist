// Copyright © 2026 Gabriel Worm
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Source: https://github.com/ntworm/ableton-rc-setlist
//
// Transport control module for Setlist UI (Task 6.4)

export class SetlistTransportController {
  constructor(wsClient) {
    this.ws = wsClient;
  }

  play() {
    this.ws.send({ type: "transport_play" });
  }

  stop() {
    this.ws.send({ type: "transport_stop" });
  }

  prev() {
    this.ws.send({ type: "transport_prev" });
  }

  next() {
    this.ws.send({ type: "transport_next" });
  }

  jumpToSong(index) {
    this.ws.send({ type: "jump_to_song", index });
  }
}
