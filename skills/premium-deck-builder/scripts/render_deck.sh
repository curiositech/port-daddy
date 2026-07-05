#!/usr/bin/env bash
# render_deck.sh — convert a .pptx (or .key after PPTX export) to per-slide PNGs
# for visual verification. Required tools: LibreOffice (soffice) + Poppler (pdftoppm).
#
# Usage:
#   ./render_deck.sh <deck.pptx> [output-dir] [dpi]
#
# Defaults:
#   output-dir = $TMPDIR/deck-render
#   dpi        = 144 (high enough for laptop-screen review)
#
# This is NOT optional. Render-and-look is the only way to verify a deck.
# "The script said it saved" is not the same as "I saw what the audience will see."

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <deck.pptx> [output-dir] [dpi]" >&2
  exit 64
fi

DECK="$1"
OUT_DIR="${2:-${TMPDIR:-/tmp}/deck-render}"
DPI="${3:-144}"

if [[ ! -f "$DECK" ]]; then
  echo "Deck not found: $DECK" >&2
  exit 66
fi

# Prereq check
command -v soffice >/dev/null 2>&1 || {
  echo "Missing: soffice (LibreOffice). Install:" >&2
  echo "  macOS:  brew install --cask libreoffice" >&2
  echo "  Linux:  apt install libreoffice  (or equivalent)" >&2
  exit 69
}
command -v pdftoppm >/dev/null 2>&1 || {
  echo "Missing: pdftoppm (Poppler). Install:" >&2
  echo "  macOS:  brew install poppler" >&2
  echo "  Linux:  apt install poppler-utils" >&2
  exit 69
}

mkdir -p "$OUT_DIR"

echo "→ Converting $DECK to PDF…"
soffice --headless --convert-to pdf "$DECK" --outdir "$OUT_DIR" >/dev/null

PDF_NAME="$(basename "${DECK%.*}").pdf"
PDF_PATH="$OUT_DIR/$PDF_NAME"

if [[ ! -f "$PDF_PATH" ]]; then
  echo "PDF conversion failed; expected $PDF_PATH" >&2
  exit 70
fi

echo "→ Rasterizing PDF to PNG at ${DPI}dpi…"
pdftoppm -png -r "$DPI" "$PDF_PATH" "$OUT_DIR/slide"

SLIDE_COUNT=$(ls "$OUT_DIR"/slide-*.png 2>/dev/null | wc -l | tr -d ' ')

echo
echo "✓ Rendered $SLIDE_COUNT slides → $OUT_DIR/slide-*.png"
echo
echo "Now open the PNGs and ACTUALLY LOOK at them."
echo "Quick browse on macOS:"
echo "  open $OUT_DIR/slide-*.png"
echo "Quick browse cross-platform:"
echo "  xdg-open $OUT_DIR/ # or: feh $OUT_DIR/slide-*.png"
