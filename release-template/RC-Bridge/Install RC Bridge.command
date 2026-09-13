#!/bin/bash
# Double-click me in Finder. Installs RC Bridge into Ableton Live's User Library:
#   ~/Music/Ableton/User Library/Remote Scripts/RCBridge
# If macOS refuses to open it ("unidentified developer"), right-click > Open once.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
source="$here/RCBridge"
if [ ! -f "$source/abletonosc/constants.py" ]; then
  echo "The RCBridge folder was not found next to this script: $source"
  echo "Unzip the whole installation kit first, then run this again."
  exit 1
fi
scripts="$HOME/Music/Ableton/User Library/Remote Scripts"
target="$scripts/RCBridge"
mkdir -p "$target"
# Replace the script but keep its logs folder: Live holds the log file open
# while it runs, and this installer must work with Live open.
find "$target" -mindepth 1 -maxdepth 1 ! -name logs -exec rm -rf {} +
cp -R "$source/." "$target/"
find "$target" -name "__pycache__" -type d -prune -exec rm -rf {} +
version="$(sed -n 's/^RCBRIDGE_VERSION *= *"\([^"]*\)".*/\1/p' "$target/abletonosc/constants.py")"
echo
echo "RC Bridge $version installed at:"
echo "  $target"
echo
echo "One step left, inside Ableton Live:"
echo "  Settings (Cmd+,) > Link, Tempo & MIDI > Control Surface > choose RCBridge"
echo "  (Input and Output can stay None.)"
echo
echo "Then, in Live's Extensions panel, open Ableton RC Setlist and press Start (or Restart)."
echo
echo "Se o Live ja estava aberto, feche e abra de novo para ele enxergar o script."
