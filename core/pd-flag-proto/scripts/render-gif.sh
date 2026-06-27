#!/usr/bin/env bash
# render-gif.sh — assemble the offscreen PNG frames into a seamless GIF.
#
# pd-flag-proto renders frame_000.png … to docs/frames/ with a synthetic clock
# (no window, no Screen-Recording permission). This turns them into a looping
# GIF using the two-pass palette method (never let ffmpeg quantize a GIF in one
# pass — it bands). Run after `cargo run --release`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
FRAMES="docs/frames"
FPS=30

[[ -f "$FRAMES/frame_000.png" ]] || { echo "no frames in $FRAMES — run: cargo run --release" >&2; exit 1; }

# Scale down for a repo-friendly GIF (the frames stay full-res for stills).
SCALE="${SCALE:-640}"

echo "[gif] palettegen…"
ffmpeg -y -framerate "$FPS" -i "$FRAMES/frame_%03d.png" \
  -vf "scale=${SCALE}:-1:flags=lanczos,palettegen=stats_mode=full" docs/palette.png >/dev/null 2>&1

echo "[gif] paletteuse → docs/flag-wave.gif"
ffmpeg -y -framerate "$FPS" -i "$FRAMES/frame_%03d.png" -i docs/palette.png \
  -lavfi "scale=${SCALE}:-1:flags=lanczos[s];[s][1:v]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 docs/flag-wave.gif >/dev/null 2>&1

# A still for the PR's screenshot slot (mid-wave frame).
cp "$FRAMES/frame_045.png" docs/flag-wave.png 2>/dev/null || cp "$FRAMES/frame_000.png" docs/flag-wave.png

echo "[gif] done:"
ls -la docs/flag-wave.gif docs/flag-wave.png
