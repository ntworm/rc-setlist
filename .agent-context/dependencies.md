# Dependencies

- `osc-min` encodes and decodes the UDP OSC messages exchanged with AbletonOSC.
- `ws` provides the browser WebSocket server and clients.
- `selfsigned` creates local TLS credentials when existing credentials are unavailable.
- `esbuild` bundles the extension; `typescript` and `tsx` type-check and execute TypeScript tooling/tests.
- `@playwright/test` verifies browser interactions and rendered public surfaces.
- Ableton Live, the Ableton Extensions host, and AbletonOSC are runtime integrations and are not available to the public CI suite; keep their adapters injectable/testable.
