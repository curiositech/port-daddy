#!/usr/bin/env bash
# Generate the icon directions × three sizes for the Port Daddy Fleet
# GitHub App, using Nano Banana Pro via the nano-banana-image-gen skill.
#
# Re-runnable. Skips directions whose 1024px output already exists unless
# --force is passed. Post-processes each 1024 to enforce alpha transparency
# (Nano Banana sometimes paints a near-white/cream backdrop even when asked
# not to — we knock that out by color-threshold). Downsamples to 256 and 60
# via Pillow Lanczos so alpha is preserved through the chain.
#
# Usage:
#   GEMINI_API_KEY=... bash scripts/generate-icons.sh           # generate missing
#   GEMINI_API_KEY=... bash scripts/generate-icons.sh --force   # regenerate all
#   bash scripts/generate-icons.sh --resize-only                # just resample existing 1024s
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONS_DIR="$APP_DIR/icons"
PROMPTS_DIR="$APP_DIR/scripts/prompts"
GENERATOR="$HOME/.claude/skills/nano-banana-image-gen/scripts/generate.py"

if [[ ! -x "$GENERATOR" && ! -f "$GENERATOR" ]]; then
  echo "[err] nano-banana-image-gen not found at $GENERATOR" >&2
  echo "      Install the skill or update GENERATOR in this script." >&2
  exit 1
fi

FORCE=0
RESIZE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --force)       FORCE=1 ;;
    --resize-only) RESIZE_ONLY=1 ;;
    *) echo "[err] unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# Each direction: <slug>:<prompt-file>:<output-dir>
# C-lantern is retained on disk as reference but is not in the active
# generation list — the active directions are lighthouse and anchor.
DIRECTIONS=(
  "A-lighthouse:A-lighthouse.txt:A-lighthouse"
  "B-anchor:B-anchor.txt:B-anchor"
)

if [[ $RESIZE_ONLY -eq 0 ]]; then
  if [[ -z "${GEMINI_API_KEY:-}" ]]; then
    if [[ -f "$HOME/coding/jbuds4life/next-app/.env.local" ]]; then
      GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' "$HOME/coding/jbuds4life/next-app/.env.local" | cut -d= -f2-)"
      export GEMINI_API_KEY
      echo "[ok] loaded GEMINI_API_KEY from jbuds4life/.env.local"
    else
      echo "[err] GEMINI_API_KEY not set and no jbuds4life/.env.local to fall back to" >&2
      exit 1
    fi
  fi
fi

post_process() {
  # $1 = path to 1024 src, $2 = path to 256 out, $3 = path to 60 out
  python3 - "$1" "$2" "$3" <<'PY'
import sys
from PIL import Image

src = sys.argv[1]
out256 = sys.argv[2]
out60 = sys.argv[3]

img = Image.open(src).convert("RGBA")
px = img.load()
W, H = img.size

# Knock out near-white / cream / fake-checker backgrounds. Nano Banana
# sometimes paints a checkered or pale-gray "transparency" pattern (~RGB
# 192,192,192) instead of true alpha. Anything desaturated above the
# lightness floor gets zeroed — cobalt #003fb8, sage #006b5f, amber
# #e8a23a, and near-black #1f1f1f are all either saturated or dark, so
# they survive the threshold. No legitimate medium gray exists in the
# active palette.
LIGHTNESS_MIN = 150   # 0-255; pixels brighter than this are candidates
SAT_MAX = 24          # max(R,G,B) - min(R,G,B); only desaturated pixels qualify
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        mx, mn = max(r, g, b), min(r, g, b)
        if mx >= LIGHTNESS_MIN and (mx - mn) <= SAT_MAX:
            px[x, y] = (r, g, b, 0)

img.save(src, format="PNG", optimize=True)

# Lanczos downscale preserves alpha through the chain (sips flattens).
img.resize((256, 256), Image.LANCZOS).save(out256, format="PNG", optimize=True)
img.resize((60, 60),  Image.LANCZOS).save(out60,  format="PNG", optimize=True)

# Snap near-zero alpha to zero on downsamples so partial-transparency haze
# doesn't bleed onto dark backgrounds.
for out_path in (out256, out60):
    di = Image.open(out_path).convert("RGBA")
    dpx = di.load()
    for y in range(di.height):
        for x in range(di.width):
            r, g, b, a = dpx[x, y]
            if 0 < a <= 24:
                dpx[x, y] = (r, g, b, 0)
    di.save(out_path, format="PNG", optimize=True)
PY
}

for entry in "${DIRECTIONS[@]}"; do
  IFS=: read -r slug prompt_file out_subdir < <(printf '%s\n' "$entry")
  out_dir="$ICONS_DIR/$out_subdir"
  mkdir -p "$out_dir"

  src_1024="$out_dir/icon-1024.png"
  src_256="$out_dir/icon-256.png"
  src_60="$out_dir/icon-60.png"

  if [[ $RESIZE_ONLY -eq 0 ]]; then
    if [[ -f "$src_1024" && $FORCE -eq 0 ]]; then
      echo "[skip] $slug — 1024 already exists (use --force to regenerate)"
    else
      echo "[gen]  $slug — calling Nano Banana Pro (1024×1024)"
      scene="$(cat "$PROMPTS_DIR/$prompt_file")"
      python3 "$GENERATOR" \
        --scene "$scene" \
        --out "$src_1024" \
        --aspect "1:1" \
        --keep-text \
        || { echo "[err] generation failed for $slug" >&2; exit 1; }
      echo "[ok]   $slug → $src_1024"
    fi
  fi

  if [[ ! -f "$src_1024" ]]; then
    echo "[skip] $slug — no 1024 source to downsample"
    continue
  fi

  echo "[post] $slug → alpha-clean + resize (256, 60)"
  post_process "$src_1024" "$src_256" "$src_60"
done

echo
echo "[done] icon set generated in $ICONS_DIR"
ls -1 "$ICONS_DIR"/*/icon-*.png 2>/dev/null || true
