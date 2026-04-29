#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCE_DIR="$ROOT_DIR/apps/FleetBar/FleetBar/Resources"
SVG_PATH="$RESOURCE_DIR/FleetBarIcon.svg"
ICNS_PATH="$RESOURCE_DIR/FleetBarIcon.icns"

if [[ ! -f "$SVG_PATH" ]]; then
  echo "FleetBar icon source missing: $SVG_PATH" >&2
  exit 1
fi

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert is required to render FleetBarIcon.svg." >&2
  exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "iconutil is required to build the macOS .icns bundle." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

ICONSET="$WORK_DIR/FleetBarIcon.iconset"
mkdir -p "$ICONSET"

render_png() {
  local size="$1"
  local output="$2"
  rsvg-convert --width "$size" --height "$size" "$SVG_PATH" --output "$ICONSET/$output"
}

render_png 16 icon_16x16.png
render_png 32 icon_16x16@2x.png
render_png 32 icon_32x32.png
render_png 64 icon_32x32@2x.png
render_png 128 icon_128x128.png
render_png 256 icon_128x128@2x.png
render_png 256 icon_256x256.png
render_png 512 icon_256x256@2x.png
render_png 512 icon_512x512.png
render_png 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET" -o "$ICNS_PATH"
echo "Generated $ICNS_PATH"
