#!/usr/bin/env bash
# Build the public facing-page reading copy from the accepted Book PDF.
# Dependencies: scripts/harbor-research/requirements-pdf.txt.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUB="$REPO_ROOT/website-v2/public/whitepaper"

exec "${BOOK_PYTHON:-python3}" "$REPO_ROOT/scripts/build_facing_pdf.py" \
  "$PUB/coordination-papers-mega-volume.pdf" \
  "$PUB/coordination-papers-mega-volume-spreads.pdf" \
  --receipt "$PUB/coordination-papers-mega-volume-spreads.json" --force "$@"
