#!/bin/bash
# capture-proof.sh — render visual proof of a pd-console PR onto an OFF-SCREEN
# virtual display, then capture per-pane stills + a short video, WITHOUT ever
# painting on the operator's physical monitor.
#
# How the "doesn't intrude on screenspace" guarantee works:
#   • pd-console opens with `--display <virtual>`, so the window lives on a
#     virtual screen (BetterDisplay / dummy plug), not your real monitor.
#   • Stills use `screencapture -l<windowid>` and video uses ScreenCaptureKit
#     window capture — both grab ONLY the pd-console window's backing store,
#     never your other windows, regardless of which display it sits on.
#
# Prerequisites (one-time, interactive — see scripts/proof/setup-virtual-display.sh):
#   1. A virtual display exists (run `setup-virtual-display.sh`).
#   2. The Terminal running this has Screen Recording permission
#      (System Settings → Privacy & Security → Screen Recording). A detached/CI
#      context is denied by TCC and capture fails loudly.
#
# Usage:
#   scripts/proof/capture-proof.sh [output-dir]
# Env:
#   PD_PROOF_DISPLAY        virtual-display selector (index or UUID). If unset, the
#                           script auto-detects a non-primary display and aborts if
#                           none is found (set PD_PROOF_ALLOW_PRIMARY=1 to override).
#   PD_PROOF_PANES          space-separated panes to snapshot
#                           (default: "fleet sorties dispatch sessions health lane")
#   PD_PROOF_VIDEO_PANE     pane to record a clip of (default: "fleet")
#   PD_PROOF_DURATION       video length in seconds (default: 10)
#   PD_PROOF_FPS            video frame rate (default: 30)
#   PD_PROOF_SETTLE         seconds of settled ScreenCaptureKit frames before a
#                           still is extracted (default: 2)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"            # core/pd-console
TARGET="$ROOT/../target"                               # workspace target/
BIN="$TARGET/release/pd-console"
REC="$TARGET/proof/recorder"
WINID="$TARGET/proof/windowid"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-$ROOT/docs/artifacts/gpui/proof-$STAMP}"

PANES="${PD_PROOF_PANES:-fleet sorties dispatch sessions health lane}"
VIDEO_PANE="${PD_PROOF_VIDEO_PANE:-fleet}"
DURATION="${PD_PROOF_DURATION:-10}"
FPS="${PD_PROOF_FPS:-30}"
SETTLE="${PD_PROOF_SETTLE:-2}"
APP_PID=""

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "✗ missing required command: $1" >&2
    exit 1
  fi
}

require_cmd cargo
require_cmd screencapture
require_cmd xcrun

mkdir -p "$OUT"

# ── Build the window binary and the recorder if needed ───────────────────────────
if [[ ! -x "$BIN" ]]; then
  echo "▸ building release window (cargo build --release --features gpui)…"
  ( cd "$ROOT" && cargo build --release --features gpui --bin pd-console )
fi
if [[ ! -x "$REC" || "$ROOT/scripts/proof/recorder.swift" -nt "$REC" ]]; then
  echo "▸ building ScreenCaptureKit recorder…"
  mkdir -p "$TARGET/proof"
  xcrun swiftc -O "$ROOT/scripts/proof/recorder.swift" -o "$REC"
fi
if [[ ! -x "$WINID" || "$ROOT/scripts/proof/windowid.swift" -nt "$WINID" ]]; then
  echo "▸ building Quartz window-id helper…"
  mkdir -p "$TARGET/proof"
  xcrun swiftc -O "$ROOT/scripts/proof/windowid.swift" -o "$WINID"
fi

# ── Resolve the virtual display ──────────────────────────────────────────────────
# `pd-console --list-displays` prints:  [idx] id=<u32> uuid=<uuid> origin=(x,y) size=WxH
list_displays() { "$BIN" --list-displays 2>/dev/null; }

resolve_display() {
  if [[ -n "${PD_PROOF_DISPLAY:-}" ]]; then
    echo "$PD_PROOF_DISPLAY"; return 0
  fi
  # Auto-detect: prefer a display whose origin is NOT (0,0) — i.e. not the primary.
  local listing; listing="$(list_displays)"
  echo "$listing" | sed 's/^/    /' >&2
  local count; count="$(echo "$listing" | grep -cE '^[[:space:]]*\[')"
  if [[ "$count" -le 1 ]]; then
    if [[ "${PD_PROOF_ALLOW_PRIMARY:-0}" == "1" ]]; then
      echo "⚠︎  only one display found — recording on the PRIMARY (will be visible)." >&2
      echo "0"; return 0
    fi
    echo "✗  No virtual display found (only the primary). pd-console would open on" >&2
    echo "   your physical monitor. Run scripts/proof/setup-virtual-display.sh first," >&2
    echo "   or set PD_PROOF_ALLOW_PRIMARY=1 to record on the primary anyway." >&2
    return 1
  fi
  # Pick the first display with a non-zero origin; fall back to the highest index.
  local idx="" last="" line ox oy
  while IFS= read -r line; do
    if [[ "$line" =~ \[([0-9]+)\] ]]; then
      last="${BASH_REMATCH[1]}"
      if [[ "$line" =~ origin=\((-?[0-9]+),(-?[0-9]+)\) ]]; then
        ox="${BASH_REMATCH[1]}"
        oy="${BASH_REMATCH[2]}"
        if [[ "$ox" != "0" || "$oy" != "0" ]]; then
          idx="$last"
          break
        fi
      fi
    fi
  done <<< "$listing"
  idx="${idx:-$last}"
  if [[ -z "$idx" ]]; then
    echo "✗  Could not parse any display indexes from pd-console --list-displays." >&2
    return 1
  fi
  echo "$idx"
}

DISPLAY_SEL="$(resolve_display)" || exit 1
echo "▸ virtual display selector: $DISPLAY_SEL"

# ── pd-console window id on screen (Quartz; robust to z-order & which display) ────
windowid() {
  if [[ -n "${APP_PID:-}" ]]; then
    "$WINID" pd-console --pid "$APP_PID" 2>/dev/null
  else
    "$WINID" pd-console 2>/dev/null
  fi
}

cleanup() {
  if [[ -n "${APP_PID:-}" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  APP_PID=""
}
trap cleanup EXIT

launch_pane() { # $1 = pane id → leaves pd-console running on the virtual display
  cleanup; sleep 1
  "$BIN" --pane "$1" --display "$DISPLAY_SEL" >/dev/null 2>&1 &
  APP_PID="$!"
}

wait_for_windowid() {
  local id=""
  local deadline=$((SECONDS + 20))
  while [[ $SECONDS -lt $deadline ]]; do
    id="$(windowid)" || true
    if [[ "${id:-}" =~ ^[0-9]+$ ]]; then
      echo "$id"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# ── Per-pane stills ───────────────────────────────────────────────────────────────
echo "▸ stills → $OUT"
for p in $PANES; do
  launch_pane "$p"
  id="$(wait_for_windowid)" || true
  if [[ "${id:-}" =~ ^[0-9]+$ ]]; then
    if command -v ffmpeg >/dev/null 2>&1; then
      # Quartz occasionally captures GPUI while individual cached layers are
      # absent. ScreenCaptureKit sees the complete composited window, so record
      # a short settled sample and extract its final frame as the still.
      still_mov="$TARGET/proof/still-$p-$$.mov"
      "$REC" --window-id "$id" --duration "$SETTLE" --fps 15 --out "$still_mov"
      ffmpeg -y -loglevel error -sseof -0.1 -i "$still_mov" -frames:v 1 "$OUT/pane-$p.png"
      rm -f "$still_mov"
    else
      sleep "$SETTLE"
      screencapture -x -o -l"$id" "$OUT/pane-$p.png"
    fi
    if [[ -s "$OUT/pane-$p.png" ]]; then
      echo "    ✓ pane-$p.png  (window $id)"
    else
      echo "    ✗ pane-$p — screencapture produced no image" >&2
      exit 1
    fi
  else
    echo "    ✗ pane-$p — pd-console window id not found within 20s (is the daemon up? did the build run?)" >&2
    exit 1
  fi
done

# ── Short video of the live, animating window ────────────────────────────────────
echo "▸ video ($DURATION s @ ${FPS}fps) of pane '$VIDEO_PANE' → $OUT/proof.mov"
launch_pane "$VIDEO_PANE"
vid="$(wait_for_windowid)" || true
if [[ "${vid:-}" =~ ^[0-9]+$ ]]; then
  "$REC" --window-id "$vid" --duration "$DURATION" --fps "$FPS" --out "$OUT/proof.mov"
  if [[ ! -s "$OUT/proof.mov" ]]; then
    echo "    ✗ recorder produced no proof.mov" >&2
    exit 1
  fi
  # A small web-friendly mp4 alongside the lossless mov, if ffmpeg is present.
  if command -v ffmpeg >/dev/null 2>&1 && [[ -s "$OUT/proof.mov" ]]; then
    ffmpeg -y -loglevel error -i "$OUT/proof.mov" \
      -vf "scale='min(1280,iw)':-2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
      "$OUT/proof.mp4"
    if [[ -s "$OUT/proof.mp4" ]]; then
      echo "    ✓ proof.mp4 (web-friendly)"
    else
      echo "    ✗ ffmpeg returned but proof.mp4 is missing/empty" >&2
      exit 1
    fi
  fi
else
  echo "    ✗ video skipped — pd-console window id not found within 20s" >&2
  exit 1
fi

# ── Manifest for pasting into the PR ─────────────────────────────────────────────
{
  echo "# pd-console visual proof — $STAMP"
  echo
  echo "Branch: \`$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')\`"
  echo "Captured on virtual display selector \`$DISPLAY_SEL\` (off the operator's screen)."
  echo
  echo "## Panes"
  for p in $PANES; do
    [[ -f "$OUT/pane-$p.png" ]] && echo "- \`$p\` — ![pane-$p](./pane-$p.png)"
  done
  echo
  echo "## Video"
  [[ -f "$OUT/proof.mp4" ]] && echo "- [proof.mp4](./proof.mp4) · [proof.mov](./proof.mov)" \
    || { [[ -f "$OUT/proof.mov" ]] && echo "- [proof.mov](./proof.mov)"; }
} > "$OUT/MANIFEST.md"

if ! compgen -G "$OUT/pane-*.png" >/dev/null; then
  echo "✗ no pane screenshots were captured" >&2
  exit 1
fi
if [[ ! -s "$OUT/proof.mov" ]]; then
  echo "✗ no proof.mov was captured" >&2
  exit 1
fi

echo "✓ done → $OUT"
ls -1 "$OUT"
