#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p docs

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to assemble docs/story-linework.gif" >&2
  exit 1
fi

ffmpeg -y -hide_banner -loglevel warning \
  -framerate "${PD_STORY_FPS:-30}" \
  -i docs/frames/frame_%03d.png \
  -vf "palettegen=max_colors=96" \
  docs/palette.png

ffmpeg -y -hide_banner -loglevel warning \
  -framerate "${PD_STORY_FPS:-30}" \
  -i docs/frames/frame_%03d.png \
  -i docs/palette.png \
  -lavfi "paletteuse=dither=bayer:bayer_scale=2" \
  docs/story-linework.gif

echo "wrote core/pd-story-linework-proto/docs/story-linework.gif"

