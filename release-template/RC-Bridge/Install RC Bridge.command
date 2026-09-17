#!/bin/bash
# Double-click me in Finder. Installs RC Bridge into Ableton Live's User Library:
#   ~/Music/Ableton/User Library/Remote Scripts/RCBridge
# Also removes any pre-1.0 legacy .ablx from earlier versions so
# Live's Extensions menu only shows one RC Setlist entry after upgrade.
# If macOS refuses to open it ("unidentified developer"), right-click > Open once.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
source="$here/RCBridge"
if [ ! -f "$source/abletonosc/constants.py" ]; then
  echo "The RCBridge folder was not found next to this script: $source"
  echo "Unzip the whole installation kit first, then run this again."
  exit 1
fi

# Step 0: remove pre-1.0 legacy .ablx from earlier versions if found.
# RC Setlist 0.x was Windows-only, but a user may have manually copied an .ablx
# to the macOS User Library; this step removes it if found.
legacy_root="$HOME/Music/Ableton/User Library/Extensions"
if [ -d "$legacy_root" ]; then
  while IFS= read -r -d '' f; do
    name="$(basename "$f")"
    # Never touch the 1.0+ package.
    if echo "$name" | grep -qiE '^RC-Setlist.*\.ablx$'; then continue; fi
    if echo "$name" | grep -qiE '^Ableton[[:space:]_-]?RC[[:space:]_-]?Setlist.*\.ablx$'; then
      echo "[cleanup] Removing legacy package: $f"
      rm -f "$f"
    fi
  done < <(find "$legacy_root" -maxdepth 1 -name '*.ablx' -print0 2>/dev/null)
fi

# Step 1: install RC Bridge remote script.
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
echo "Then, in Live's Extensions panel, open RC Setlist and press Start (or Restart)."
echo
echo "Se o Live ja estava aberto, feche e abra de novo para ele enxergar o script."
