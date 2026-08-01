# Architecture

`build.ts` bundles the TypeScript extension to `dist/extension.js`. `src/server-lifecycle.ts` is the composition root: it constructs the `SetlistManager`, `OSCClient`, `CommandBus`, HTTP(S) server, and `WebSocketServerManager`, then connects OSC events and browser commands to shared state.

State flows from AbletonOSC through `src/integration/osc-client.ts` into `src/core/setlist-manager.ts`. The manager exposes serialized state to `src/server/ws.ts`; browser controllers in `static/setlist/` and the stage client consume that state and send token-gated commands back through the WebSocket boundary and `src/commands/handlers.ts`.

Profiles, order, lyrics, preferences, and generated credentials are persisted under runtime-owned directories selected by the Ableton extension host. Static browser assets are copied into the production bundle. Public documentation under `docs/` is a separate static surface but is checked by the same release contracts.
