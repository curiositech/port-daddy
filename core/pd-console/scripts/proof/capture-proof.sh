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
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"            # core/pd-console
TARGET="$ROOT/../target"                               # workspace target/
BIN="$TARGET/release/pd-console"
REC="$TARGET/proof/recorder"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-$ROOT/docs/artifacts/gpui/proof-$STAMP}"

PANES="${PD_PROOF_PANES:-fleet sorties dispatch sessions health lane}"
VIDEO_PANE="${PD_PROOF_VIDEO_PANE:-fleet}"
DURATION="${PD_PROOF_DURATION:-10}"
FPS="${PD_PROOF_FPS:-30}"

mkdir -p "$OUT"

# ── Build the window binary and the recorder if needed ───────────────────────────
if [[ ! -x "$BIN" ]]; then
  echo "▸ building release window (cargo build --release --features gpui)…"
  ( cd "$ROOT" && cargo build --release --features gpui --bin pd-console )
fi
if [[ ! -x "$REC" ]]; then
  echo "▸ building ScreenCaptureKit recorder…"
  mkdir -p "$TARGET/proof"
  xcrun swiftc -O "$ROOT/scripts/proof/recorder.swift" -o "$REC"
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
  local idx
  idx="$(echo "$listing" | awk -F'[][]' '/origin=\(/{i=$2} /origin=\([^0]/{print i; exit}')"
  if [[ -z "$idx" ]]; then
    idx="$(echo "$listing" | grep -oE '\[[0-9]+\]' | tr -d '[]' | sort -n | tail -1)"
  fi
  echo "$idx"
}

DISPLAY_SEL="$(resolve_display)" || exit 1
echo "▸ virtual display selector: $DISPLAY_SEL"

# ── pd-console window id on screen (Quartz; robust to z-order & which display) ────
windowid() {
  python3 - <<'PY' 2>/dev/null
import Quartz
ws = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
    Quartz.kCGNullWindowID)
best = None
for w in ws:
    if str(w.get('kCGWindowOwnerName', '')) == 'pd-console':
        b = w['kCGWindowBounds']; area = int(b['Width']) * int(b['Height'])
        if best is None or area > best[1]:
            best = (int(w['kCGWindowNumber']), area)
if best:
    print(best[0])
PY
}

cleanup() { pkill -f "target/release/pd-console" 2>/dev/null || true; }
trap cleanup EXIT

launch_pane() { # $1 = pane id → leaves pd-console running on the virtual display
  cleanup; sleep 1
  "$BIN" --pane "$1" --display "$DISPLAY_SEL" >/dev/null 2>&1 &
  sleep 5   # window open + first 2s daemon refresh + 500ms drain
}

# ── Per-pane stills ───────────────────────────────────────────────────────────────
echo "▸ stills → $OUT"
for p in $PANES; do
  launch_pane "$p"
  id="$(windowid)" || true
  if [[ "${id:-}" =~ ^[0-9]+$ ]]; then
    screencapture -x -o -l"$id" "$OUT/pane-$p.png"
    echo "    ✓ pane-$p.png  (window $id)"
  else
    echo "    ✗ pane-$p — window id not found (is the daemon up? did the build run?)"
  fi
done

# ── Short video of the live, animating window ────────────────────────────────────
echo "▸ video ($DURATION s @ ${FPS}fps) of pane '$VIDEO_PANE' → $OUT/proof.mov"
launch_pane "$VIDEO_PANE"
vid="$(windowid)" || true
if [[ "${vid:-}" =~ ^[0-9]+$ ]]; then
  "$REC" --window-id "$vid" --duration "$DURATION" --fps "$FPS" --out "$OUT/proof.mov"
  # A small web-friendly mp4 alongside the lossless mov, if ffmpeg is present.
  if command -v ffmpeg >/dev/null 2>&1 && [[ -s "$OUT/proof.mov" ]]; then
    ffmpeg -y -loglevel error -i "$OUT/proof.mov" \
      -vf "scale='min(1280,iw)':-2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
      "$OUT/proof.mp4" && echo "    ✓ proof.mp4 (web-friendly)"
  fi
else
  echo "    ✗ video skipped — pd-console window id not found"
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

echo "✓ done → $OUT"
ls -1 "$OUT"
