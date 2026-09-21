#!/usr/bin/env bash
# Verify pinned SVGs/notices, then rebuild nine PDF derivatives.
# Only a new output directory is written; source assets are never overwritten.
set -euo pipefail
revision=951813ce76a859d4d8b145366972cbb237147a4e
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_dir="$root/website-v2/public/whitepaper/figures/lucide"
output="${1:?Usage: bash scripts/harbor-research/vendor_lucide_book_icons.sh NEW_OUTPUT_DIR}"
if [[ -e "$output" ]]; then
  echo "Refusing existing output directory: $output" >&2
  exit 2
fi
case "$output" in /tmp|/tmp/*|/private/tmp|/private/tmp/*)
  echo "Choose a persistent output directory, not /tmp." >&2; exit 2 ;;
esac
command -v curl >/dev/null
command -v rsvg-convert >/dev/null
mkdir -p "$output"
output="$(cd "$output" && pwd)"
base="https://raw.githubusercontent.com/lucide-icons/lucide/$revision"
curl -q -fsSL --max-time 30 "$base/LICENSE" -o "$output/LICENSE"
cmp "$output/LICENSE" "$source_dir/LICENSE"
# Full pinned LICENSE is authoritative; retain supplementary notices as well.
cp "$source_dir/LICENSE.lucide.txt" "$source_dir/LICENSE.feather.txt" "$output/"
for icon in book-open calculator file-text flask-conical key-round list-checks lock-keyhole scroll-text workflow; do
  curl -q -fsSL --max-time 30 "$base/icons/$icon.svg" -o "$output/$icon.svg"
  cmp "$output/$icon.svg" "$source_dir/$icon.svg"
  rsvg-convert --format=pdf1.5 --output="$output/$icon.pdf" "$output/$icon.svg"
done
rsvg-convert --version
echo "Verified nine pinned SVG sources; regenerated PDFs in $output"
echo "PDF bytes may vary with librsvg/Cairo versions; review before replacing frozen assets."
