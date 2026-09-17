#!/bin/bash
# Migrates RC Setlist data from the 0.x layout to the 1.0 layout.
#
# Source:      ~/Library/Application Support/Ableton/Extensions Data/ntworm.ableton-rc-setlist
# Destination: ~/Library/Application Support/Ableton/Extensions Data/ntworm.rc-setlist
#
# Behaviour matches the Windows Migrate-RC-Setlist-Data.ps1:
#   - Never moves or deletes anything in the source.
#   - Never overwrites a file already present at the destination.
#   - Skips the migration entirely if the destination already has profiles/.
#   - Idempotent.
#
# Double-click me in Finder. If macOS refuses (unidentified developer),
# right-click > Open once.

set -e
here="$(cd "$(dirname "$0")" && pwd)"

extensions_data="$HOME/Library/Application Support/Ableton/Extensions Data"
source="$extensions_data/ntworm.ableton-rc-setlist"
dest="$extensions_data/ntworm.rc-setlist"
entries=(profiles project-setlists token ui-locale auto-start certs)

if [ ! -d "$source" ]; then
  echo "Source directory not found: $source"
  echo "Nothing to migrate. If you never installed the 0.x version you can ignore this."
  exit 1
fi

if [ -d "$dest/profiles" ]; then
  echo "Destination already has profiles/: $dest"
  echo "Nothing to copy."
  exit 0
fi

echo "Migrating RC Setlist data:"
echo "  from: $source"
echo "  to:   $dest"
echo ""

mkdir -p "$dest"

copy_tree() {
  local src="$1"
  local dst="$2"
  if [ ! -d "$src" ]; then
    return
  fi
  mkdir -p "$dst"
  # Use find to walk the tree; never overwrite.
  find "$src" -type f | while IFS= read -r f; do
    rel="${f#$src/}"
    target="$dst/$rel"
    if [ -e "$target" ]; then
      echo "    = $rel (already present)"
    else
      mkdir -p "$(dirname "$target")"
      cp "$f" "$target"
      echo "    + $rel"
    fi
  done
}

for entry in "${entries[@]}"; do
  src_path="$source/$entry"
  if [ ! -e "$src_path" ]; then
    echo "  $entry: not present in source, skipped"
    continue
  fi
  dst_path="$dest/$entry"
  if [ -d "$src_path" ]; then
    echo "  $entry: merging"
    copy_tree "$src_path" "$dst_path"
  elif [ -e "$dst_path" ]; then
    echo "  $entry: already present at destination, skipped"
  else
    mkdir -p "$(dirname "$dst_path")"
    cp "$src_path" "$dst_path"
    echo "  $entry: copied"
  fi
done

echo ""
echo "Done. The 0.x data in $source was left untouched."
echo "Open Ableton Live, open the RC Setlist extension and press Start."
