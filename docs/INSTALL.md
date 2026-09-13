# Install Ableton RC Setlist

## Requirements

- Ableton Live 12.4.5+ Suite (Beta) with Extensions support.
- RC Bridge selected as a Control Surface in Live. It ships with the extension
  and the installation kit; step 1 below installs it. (A stock
  [AbletonOSC](https://github.com/ideoforms/AbletonOSC) also works.)
- Windows for the validated release path. macOS is experimental.

Node.js 24.16.0 is required only for source development, not for installing the
release package.

## 1. Install RC Bridge

RC Bridge is the Live Remote Script that Ableton RC Setlist talks to. It is a
fork of the MIT-licensed [AbletonOSC](https://github.com/ideoforms/AbletonOSC)
that answers each client on its own port, so it never fights another RC
extension for a reply port and runs beside a stock AbletonOSC if you have one.
Nothing to download: it is inside the extension and inside the installation kit.

Pick one of the two ways to put it in Live's User Library:

- **From the kit** — in the `RC-Bridge` folder, double-click
  `Install-RC-Bridge.cmd` (Windows) or `Install RC Bridge.command` (macOS;
  right-click › Open the first time). It copies the script and prints the last
  step.
- **By hand** — copy the `RCBridge` folder from the kit into
  - Windows: `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\RCBridge`
  - macOS: `~/Music/Ableton/User Library/Remote Scripts/RCBridge`

Then the one step Live cannot do for you: open
**Settings/Preferences > Link, Tempo & MIDI** and choose **RCBridge** as a
Control Surface. Input and Output can stay `None`. If Live was already open
when the script was copied, close and reopen it once so it sees the new folder.

Use `User Library/Remote Scripts/`, not Live's hidden `User Remote Scripts`
preferences folder (that one is for `UserConfiguration.txt`). Confirm that
`RCBridge/__init__.py` exists directly at that location, without another
nested `RCBridge` folder.

If you already use AbletonOSC for other tools, keep it. RC Bridge listens on
port 11020; AbletonOSC keeps 11000. RC Setlist looks for RC Bridge first and
falls back to AbletonOSC when it is not there, so both work — RC Bridge is the
one that also works next to RC Surface. The panel's OSC line says which one is
in use (`via RC Bridge 1.0.0 on port 11020`). The extension itself cannot
copy the script for you: Live runs extensions in a sandbox that cannot write
to your User Library.

## 2. Install Ableton RC Setlist

1. Download `Ableton-RC-Setlist-0.5.0.ablx` from the
   [latest GitHub release](https://github.com/ntworm/rc-setlist/releases/latest).
2. Open the `.ablx` and follow the Ableton Live installation prompt.
3. Restart Live if the extension does not appear immediately.
4. Open **Extensions > Ableton RC Setlist**.

The same `.ablx` contains both interface languages. English is selected by
default; choose **Brazilian Portuguese** from the language menu in the panel,
Stage Control or Performance view. The choice is remembered locally.

Do not install SDK or CLI archives as an end user.

## 3. Start the local server

1. In the Ableton RC Setlist panel, choose **Start Server**.
2. Confirm the panel reports a local URL and QR code.
3. On the host computer, open `https://localhost:4444/setlist`.
4. On a phone/tablet, use the LAN URL or QR code shown by the panel.

First connection: your browser may show `ERR_CERT_AUTHORITY_INVALID` because RC
Setlist creates a local self-signed certificate. Continue only when the address
exactly matches the IP shown in the Live panel and you are on a trusted LAN.
Each browser/device may require this once.

## 4. Open the two views

- Operator workspace: `https://<host-ip>:4444/setlist`
- Stage display: `https://<host-ip>:4444/performance`

The controller URL contains a token. Treat it like a local password and do not
post screenshots containing the full URL.

## 5. Verify the first session

1. Load a Live Set with fictional test locators from [the example](../examples/README.md).
2. In the RC Setlist panel, choose **Check OSC** and confirm received traffic.
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
