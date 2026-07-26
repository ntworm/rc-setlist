# Privacy

Ableton RC Setlist is local-first. It has no account system, telemetry, advertising,
analytics or cloud synchronization.

## Data stored locally

The extension stores profiles, ordering, lyrics, preferences, logs, generated
certificates and exports inside the storage directory supplied by Ableton's
Extensions host. Profile data is separated under profile-specific directories.
The extension does not write beside the `.als` project file.

Removing the extension does not automatically remove that storage. See
[docs/INSTALL.md](docs/INSTALL.md#uninstall) for cleanup guidance.

## Local network traffic

The host serves the operator and performance pages on TCP port `4444` and uses
WebSockets for live state. AbletonOSC communication stays on the host through
UDP. Browser clients receive setlist state, timing, lyrics and status needed for
the interface. A controller token protects write-capable WebSocket actions;
keep controller URLs private.

## Certificates

Ableton RC Setlist creates a per-install self-signed certificate and private key in the
extension storage directory. Private keys are never packaged in release files.

## Third parties

The runtime does not intentionally contact an Ableton RC Setlist service. Ableton Live,
the Ableton Extensions host and AbletonOSC are separate software governed by
their own terms. Package and browser-component licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
