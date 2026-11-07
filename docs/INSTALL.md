# Install RC Setlist

## Requirements

- Ableton Live 12.4.5+ Suite (Beta) with Extensions support.
- Windows for the validated release path. macOS is experimental.
- RC Bridge selected as a Control Surface in Live; the section below installs
  it. A stock [AbletonOSC](https://github.com/ideoforms/AbletonOSC) also works.

Node.js 24.16.0 is required for source development, not for installing the
release package.

After the installation, follow [Getting started](GETTING-STARTED.md) for the
first show.

## Install RC Bridge

RC Bridge is the Live Remote Script that RC Setlist talks to. It is a fork of
the MIT-licensed [AbletonOSC](https://github.com/ideoforms/AbletonOSC) that
answers each client on its own port, so it never fights another RC extension
for a reply port and runs beside a stock AbletonOSC. It is inside the extension
and inside the installation kit, so there is nothing to download.

Put the script in Live's User Library in one of two ways:

- **From the kit** — in the `RC-Bridge` folder, double-click
  `Install-RC-Bridge.cmd` (Windows) or `Install RC Bridge.command` (macOS;
  right-click › Open the first time). It copies the script and prints the last
  step.
- **By hand** — copy the `RCBridge` folder from the kit into
  `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\RCBridge` on
  Windows or `~/Music/Ableton/User Library/Remote Scripts/RCBridge` on macOS.

Then open **Settings/Preferences > Link, Tempo & MIDI** and choose **RCBridge**
as a Control Surface. Input and Output can stay `None`. If Live was already
open when the script was copied, close and reopen it once so it sees the new
folder.

Use `User Library/Remote Scripts/`, not Live's hidden `User Remote Scripts`
preferences folder, which holds `UserConfiguration.txt`. Confirm that
`RCBridge/__init__.py` exists directly at that location, without another
nested `RCBridge` folder.

RC Bridge listens on port 11020 and AbletonOSC keeps 11000. RC Setlist looks
for RC Bridge first and falls back to AbletonOSC when it is not there, so both
work; RC Bridge is the one that also works next to RC Surface. The panel's OSC
line says which one is in use (`via RC Bridge 1.0.0 on port 11020`). The
extension itself cannot copy the script for you: Live runs extensions in a
sandbox that cannot write to your User Library.

## Install the extension

1. Download `RC-Setlist-1.1.0.ablx` from the
   [latest GitHub release](https://github.com/ntworm/rc-setlist/releases/latest).
2. Open the `.ablx` and follow the Ableton Live installation prompt.
3. Restart Live if the extension does not appear immediately.
4. Open **Extensions > RC Setlist**.

The same `.ablx` contains both interface languages. English is selected by
default; choose **Brazilian Portuguese** from the language menu in the panel,
Stage Control or Performance view. The choice is remembered locally.

Do not install SDK or CLI archives as an end user.

## Start the local server

1. In the RC Setlist panel, choose **Start Server**.
2. Confirm the panel reports a local URL and QR code.
3. On the host computer, open `https://localhost:4444/setlist`.
4. On a phone or tablet, use the LAN URL or the QR code shown by the panel.

RC Setlist creates a certificate authority for this computer, valid only for
localhost and private network addresses, and signs its server certificate with
it. Until the certificate of this computer is installed on the device, the
browser shows `ERR_CERT_AUTHORITY_INVALID`. Scan the **Phone certificate** QR
in the Live panel: it opens a plain page on port `4445` with the file and the
steps for Android and iPhone. Until then, continue only when the address
exactly matches the IP shown in the Live panel and you are on a trusted LAN.

The controller URL contains a token. Treat it like a local password and do not
post screenshots containing the full URL.

## Open the views

- Stage Control, for the operator: `https://<host-ip>:4444/setlist`
- Performance, the read-only display for the band: `https://<host-ip>:4444/performance`

## Migrate data from a 0.x build

Data from a 0.x build lives in the `ntworm.ableton-rc-setlist` folder, where
the profiles, project-setlists, token and preferences are stored; the current
extension uses `ntworm.rc-setlist`.

Run the kit's `Migrate-RC-Setlist-Data.cmd` (Windows) or
`Migrate RC Setlist Data.command` (macOS) **once, before opening Live**. It
copies your old data into the new folder without touching the old one and
never overwrites a file that already exists at the destination.

The kit's `RC-Bridge/Install-RC-Bridge.ps1` (Windows) or
`RC-Bridge/Install RC Bridge.command` (macOS) removes any
`Ableton-RC-Setlist-*.ablx` that was previously installed in your User
Library. No separate uninstall step is needed. If you installed the extension
from a 0.x build, use the included `uninstall-pre-1.0-extensions.ps1` as a
manual fallback (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)).

In Live, remove the old **Ableton RC Setlist** entry from **Settings >
Extensions** so the two extensions do not coexist on the same machine.

## Update

Install the newer `.ablx` through Live. Keep a backup of important lyrics and
exports before replacing a pre-release build. Profile data is stored separately
from the application package, so it stays available after an update.

## Uninstall

1. Stop RC Setlist in its panel.
2. Remove the extension through Live's extension management flow.
3. Restart Live.
4. To remove saved profiles, lyrics, certificates and preferences as well, delete
   the RC Setlist storage directory shown in the Ableton Extensions logs.

Do not delete a broad Ableton user-library directory. Remove only the confirmed
RC Setlist storage target.
