#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Convert screen recording to optimized GIF
# ═══════════════════════════════════════════════════════════════════════
#
# Takes the most recent .mov from ~/Desktop (macOS screen recording default)
# and converts to a high-quality, reasonable-size GIF.
#
# Output: demos/gifs/fleet-demo.gif
#
# Optimization targets:
#   - 15fps (smooth enough, half the file size of 30fps)
#   - 960px wide (good for GitHub README, Twitter, HN)
#   - Two-pass palette for accurate colors
#   - ~5-15MB final size for a 15s recording
#
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
GIF_DIR="$DEMO_DIR/gifs"
mkdir -p "$GIF_DIR"

# Find the most recent screen recording
INPUT="${1:-$(ls -t ~/Desktop/Screen\ Recording*.mov 2>/dev/null | head -1)}"

if [ -z "$INPUT" ] || [ ! -f "$INPUT" ]; then
    echo "No screen recording found on Desktop."
    echo "Usage: $0 [path-to-recording.mov]"
    exit 1
fi

echo "Input:  $INPUT"
echo "Output: $GIF_DIR/fleet-demo.gif"
echo ""

# Get video duration
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT" | cut -d. -f1)
echo "Duration: ${DURATION}s"

# Two-pass GIF encoding (much better colors than single-pass)
# Pass 1: Generate optimal palette
echo "Pass 1: Generating palette..."
ffmpeg -y -i "$INPUT" \
    -vf "fps=15,scale=960:-1:flags=lanczos,palettegen=max_colors=256:stats_mode=diff" \
    -loglevel warning \
    /tmp/fleet-demo-palette.png

# Pass 2: Encode with palette
echo "Pass 2: Encoding GIF..."
ffmpeg -y -i "$INPUT" -i /tmp/fleet-demo-palette.png \
    -lavfi "fps=15,scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=floyd_steinberg" \
    -loglevel warning \
    "$GIF_DIR/fleet-demo.gif"

# Report
SIZE=$(du -h "$GIF_DIR/fleet-demo.gif" | cut -f1)
echo ""
echo "Done!"
echo "  File: $GIF_DIR/fleet-demo.gif"
echo "  Size: $SIZE"
echo "  Duration: ${DURATION}s @ 15fps"
echo ""

# Copy to website public for serving
cp "$GIF_DIR/fleet-demo.gif" "$DEMO_DIR/../website-v2/public/gifs/fleet-demo.gif" 2>/dev/null && \
    echo "  Copied to website-v2/public/gifs/fleet-demo.gif" || true

# Clean up palette
rm -f /tmp/fleet-demo-palette.png

echo ""
echo "Preview: open $GIF_DIR/fleet-demo.gif"
