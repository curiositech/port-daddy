#!/usr/bin/env bash
#
# build-spreads.sh — build the physical 14x10 in two-page spread edition of the Book
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUB="$REPO_ROOT/website-v2/public/whitepaper"

if [ ! -f "$PUB/coordination-papers-mega-volume.pdf" ]; then
  echo "Error: $PUB/coordination-papers-mega-volume.pdf not found. Build the book first." >&2
  exit 1
fi

echo "Building 14x10 in facing two-page spreads edition..."
cd "$PUB"
xelatex -interaction=nonstopmode coordination-papers-mega-volume-spreads.tex

# Remove auxiliary build files
echo "Successfully built $PUB/coordination-papers-mega-volume-spreads.pdf"

if [ -f "$REPO_ROOT/scripts/render_book_spreads.py" ]; then
  echo "Rendering facing spreads..."
  python3 "$REPO_ROOT/scripts/render_book_spreads.py" "$@" || true
fi
