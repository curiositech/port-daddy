#!/usr/bin/env bash
# Fetch the static, verified, hotlink-safe gallery images into ./gallery/.
# Skips GitHub user-attachments + CMS-hashed URLs (they rotate / hotlink-protect).
# Re-run any time; idempotent (curl -z skips unchanged). Honors the repo rule:
# nothing is written to /tmp.
#
# Usage:  bash docs/product-research/flashy-rust-guis/scripts/fetch-gallery.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HERE/gallery"
mkdir -p "$OUT"

# name|url  (only verified-200 static assets)
ASSETS=(
  "zed-videogame-hero.png|https://images.zed.dev/blog/videogame/feature_image.png"
  "vello-splash-tiger.png|https://github.com/linebender/vello/assets/8573618/cc2b742e-2135-4b70-8051-c49aeddb5d19"
  "lapce-editor.png|https://raw.githubusercontent.com/lapce/lapce/master/extra/images/screenshot.png"
  "rerun-hero.png|https://static.rerun.io/opf_screenshot/bee51040cba93c0bae62ef6c57fa703704012a41/full.png"
  "egui-demo.gif|https://raw.githubusercontent.com/emilk/egui/main/media/demo.gif"
  "iced-solar-system.gif|https://iced.rs/examples/solar_system.gif"
  "freya-components-gallery.png|https://freyaui.dev/blog/0.3/components_gallery.png"
  "sniffnet-overview.png|https://raw.githubusercontent.com/GyulyVGC/sniffnet/main/resources/repository/pages/overview.png"
)

for entry in "${ASSETS[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  echo "==> $name"
  curl -fsSL -z "$OUT/$name" -o "$OUT/$name" "$url" \
    && echo "    ok  ($(du -h "$OUT/$name" | cut -f1))" \
    || echo "    FAILED: $url"
done

echo "Done. Files in $OUT"
