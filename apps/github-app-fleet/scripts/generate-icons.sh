#!/usr/bin/env bash
# Generate the three icon directions × three sizes for the Port Daddy Fleet
# GitHub App, using Nano Banana Pro via the nano-banana-image-gen skill.
#
# Re-runnable. Skips directions whose 1024px output already exists unless
# --force is passed. Downsamples to 256px and 60px via sips (macOS stdlib).
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
DIRECTIONS=(
  "A-lighthouse:A-lighthouse.txt:A-lighthouse"
  "B-anchor:B-anchor.txt:B-anchor"
  "C-lantern:C-lantern.txt:C-lantern"
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

for entry in "${DIRECTIONS[@]}"; do
  IFS=: read -r slug prompt_file out_subdir <<< "$entry"
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

  echo "[size] $slug → 256, 60"
  sips -Z 256 "$src_1024" --out "$src_256"  > /dev/null
  sips -Z 60  "$src_1024" --out "$src_60"   > /dev/null
done

echo
echo "[done] icon set generated in $ICONS_DIR"
ls -1 "$ICONS_DIR"/*/icon-*.png 2>/dev/null || true
