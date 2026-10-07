#!/usr/bin/env bash
# Rebuild the Book's unmodified Lucide SVGs and vector PDFs from pinned upstream.
set -euo pipefail
revision=951813ce76a859d4d8b145366972cbb237147a4e
root="$(cd "$(dirname "$0")/../.." && pwd)"
destination="$root/website-v2/public/whitepaper/figures/lucide"
mirror="$root/whitepaper/figures/lucide"
mkdir -p "$destination" "$mirror"
base="https://raw.githubusercontent.com/lucide-icons/lucide/$revision"
curl -fsSL "$base/LICENSE" -o "$destination/LICENSE"
for icon in scroll-text book-open key-round flask-conical lock-keyhole calculator list-checks file-text terminal workflow; do
  curl -fsSL "$base/icons/$icon.svg" -o "$destination/$icon.svg"
  rsvg-convert --format=pdf1.5 --output="$destination/$icon.pdf" "$destination/$icon.svg"
  cp "$destination/$icon.svg" "$destination/$icon.pdf" "$mirror/"
done
cp "$destination/LICENSE" "$mirror/LICENSE"
