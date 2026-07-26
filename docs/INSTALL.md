# Install Ableton RC Setlist

## Requirements

- Ableton Live 12.4.5+ Suite (Beta) with Extensions support.
- [AbletonOSC](https://github.com/ideoforms/AbletonOSC) installed as a Control Surface.
- Windows for the validated 0.3.0 release path. macOS is experimental.

Node.js 24.16.0 is required only for source development, not for installing the
release package.

## 1. Install AbletonOSC

Ableton RC Setlist uses the external MIT-licensed AbletonOSC Remote Script for transport
and Live Object Model operations. It is not included in this repository or in
the Ableton RC Setlist release kit.

1. Download AbletonOSC from its [upstream repository](https://github.com/ideoforms/AbletonOSC).
2. Follow its upstream installation instructions.
3. Place the `AbletonOSC` folder directly in your Live Remote Scripts directory.
   Common user-library locations are:
   - Windows: `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\`
   - macOS: `~/Music/Ableton/User Library/Remote Scripts/`
4. Restart Live.
5. Open **Settings/Preferences > Link, Tempo & MIDI** and select AbletonOSC as a
   Control Surface.

If AbletonOSC does not appear, check that the folder is not nested twice and
consult its upstream documentation.

## 2. Install Ableton RC Setlist

1. Download `Ableton-RC-Setlist-0.3.0.ablx` from the
   [latest GitHub release](https://github.com/ntworm/rc-setlist/releases/latest).
2. Open the `.ablx` and follow the Ableton Live installation prompt.
3. Restart Live if the extension does not appear immediately.
4. Open **Extensions > Ableton RC Setlist**.

Do not install SDK or CLI archives as an end user.

## 3. Start the local server

1. In the Ableton RC Setlist panel, choose **Start Server**.
2. Confirm the panel reports a local URL and QR code.
3. On the host computer, open `https://localhost:4444/setlist`.
4. On a phone/tablet, use the LAN URL or QR code shown by the panel.

The browser will warn about a self-signed certificate. Continue only when the
address matches the Ableton RC Setlist host on a trusted LAN. Each browser/device may
need to accept the certificate once.

## 4. Open the two views

- Operator workspace: `https://<host-ip>:4444/setlist`
- Stage display: `https://<host-ip>:4444/performance`

The controller URL contains a token. Treat it like a local password and do not
post screenshots containing the full URL.

## 5. Verify the first session

1. Load a Live Set with fictional test locators from [the example](../examples/README.md).
2. Confirm AbletonOSC reports activity.
3. Confirm songs/sections appear in `/setlist`.
4. Open `/performance` and verify the active song follows Live's playhead.
5. Try Play/Stop and a guarded Previous/Next hold from the controller view.
6. Close and reopen Live to verify your selected profile and auto-start choice.

For the complete matrix, use [TESTER-GUIDE.md](TESTER-GUIDE.md).

## Update

Install the newer `.ablx` through Live. Keep a backup of important lyrics and
exports before replacing a pre-release build. Profile data is stored separately
from the application package and should remain available after an update.

## Uninstall

1. Stop Ableton RC Setlist in its panel.
2. Remove the extension through Live's extension management flow.
3. Restart Live.
4. To remove saved profiles, lyrics, certificates and preferences as well, delete
   the Ableton RC Setlist storage directory shown in the Ableton Extensions logs.

Do not delete a broad Ableton user-library directory. Remove only the confirmed
Ableton RC Setlist storage target.
