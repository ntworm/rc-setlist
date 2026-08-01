# Risks

- The HTTP/WebSocket service is reachable on the trusted LAN. Reads reveal setlist data; writes require the controller token. Never log or commit tokens, private keys, controller URLs, local paths, or user content.
- Stop, panic, transport, and jump commands are stage-safety paths. Do not let non-critical long-running work delay them or silently report success.
- Lyrics, profiles, ordering, and preferences are user data. Validate network input before mutation, preserve unsaved buffers on failure, and prefer atomic persistence.
- The application and landing page are local-first. External runtime fonts, analytics, or CDNs violate the documented contract and public tests.
- Browser state and persisted JSON may be malformed after interrupted writes or older versions. Parse defensively and recover without preventing startup.
- Production packaging can pass public CI without Ableton-specific dependencies; run `ci:release` only when the verified Ableton dependency bundle is present.
- Generated media and public-file manifests are release artifacts. Update them intentionally and never hand-edit generated screenshots to hide a regression.
