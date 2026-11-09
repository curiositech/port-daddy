#!/usr/bin/env bash
# Build exactly the source inventory distributed with this archive.
set -euo pipefail
BOOK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BOOK_ROOT"
case "${1:-}" in
  '')
    export PD_BOOK_FONT_PROFILE=open-proof
    unset PD_BOOK_FONT_DIR
    ;;
  --publication)
    : "${PD_BOOK_FONT_DIR:?Set PD_BOOK_FONT_DIR to your separately licensed Suisse OTF directory}"
    export PD_BOOK_FONT_PROFILE=suisse
    ;;
  *) echo "Usage: bash book/BUILDING.sh [--publication]" >&2; exit 2 ;;
esac
for command in node python3 xelatex makeindex; do
  command -v "$command" >/dev/null || { echo "Missing build dependency: $command (see book/BUILDING.md)" >&2; exit 127; }
done
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 or newer is required"'
node -e 'if(Number(process.versions.node.split(".")[0])<22) throw Error("Node.js 22 or newer is required")'
if [ -f SOURCE-MANIFEST.json ]; then
  python3 scripts/build-book-source.py verify
  export SOURCE_DATE_EPOCH="$(python3 -c 'import json; print(json.load(open("SOURCE-MANIFEST.json"))["build"]["sourceDateEpoch"])')"
fi
mkdir -p website-v2/public/whitepaper
bash scripts/build-whitepapers.sh coordination-papers-mega-volume
