#!/usr/bin/env bash
# capture-proof.sh - render visual proof of a pd-console PR onto an off-screen
# virtual display, then capture per-pane stills plus a short video without
# touching the operator's other windows.
#
# Safety contract:
#   - pd-console launches with --display <virtual> whenever possible.
#   - All stills and fallback video frames use screencapture -l<windowid>.
#   - Window lookup is filtered to the harness-launched PID.
#   - No full-screen or display-wide capture is used by this harness.
#
# Usage:
#   scripts/proof/capture-proof.sh [output-dir]
#   scripts/proof/capture-proof.sh --dry-run [output-dir]
#
# Env:
#   PD_PROOF_DRY_RUN       set 1 for deterministic receipt/manifest smoke output
#   PD_PROOF_STAMP         deterministic stamp for artifact folder/receipt
#   PD_PROOF_DISPLAY       virtual-display selector (index or UUID)
#   PD_PROOF_PANES         space-separated panes to snapshot
#   PD_PROOF_VIDEO_PANE    pane to record a clip of
#   PD_PROOF_DURATION      video length in seconds
#   PD_PROOF_FPS           video frame rate
#   PD_PROOF_SETTLE        seconds to wait after window id before capture
#   PD_PROOF_VIDEO_MODE    auto | screencapture | sck
#   PD_PROOF_BIN           source pd-console binary to build/copy from
#   PD_PROOF_LAUNCH_BIN    proof-owned binary path to launch
#   PD_PROOF_OWNER_NAME    Quartz owner name to match; defaults to launch basename
#   PD_PROOF_ALLOW_PRIMARY set 1 only for explicit local debugging on primary
set -euo pipefail

usage() {
  sed -n '1,36p' "$0" | sed 's/^# \{0,1\}//'
}

DRY_RUN="${PD_PROOF_DRY_RUN:-0}"
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"            # core/pd-console
TARGET="$ROOT/../target"                               # workspace target/
SOURCE_BIN="${PD_PROOF_BIN:-$TARGET/release/pd-console}"
LAUNCH_BIN="${PD_PROOF_LAUNCH_BIN:-$TARGET/proof/pd-console-proof}"
BIN="$LAUNCH_BIN"
OWNER_NAME="${PD_PROOF_OWNER_NAME:-$(basename "$LAUNCH_BIN")}"
REC="$TARGET/proof/recorder"
WINID="$TARGET/proof/windowid"
STAMP="${PD_PROOF_STAMP:-$(date -u +%Y-%m-%dT%H-%M-%SZ)}"
OUT="${1:-$ROOT/docs/artifacts/gpui/proof-$STAMP}"

PANES="${PD_PROOF_PANES:-fleet sorties dispatch sessions health lane}"
VIDEO_PANE="${PD_PROOF_VIDEO_PANE:-fleet}"
DURATION="${PD_PROOF_DURATION:-10}"
FPS="${PD_PROOF_FPS:-30}"
SETTLE="${PD_PROOF_SETTLE:-3}"
VIDEO_MODE="${PD_PROOF_VIDEO_MODE:-auto}"
DAEMON_URL="${PORT_DADDY_URL:-http://127.0.0.1:9876}"

APP_PID=""
DISPLAY_SEL="${PD_PROOF_DISPLAY:-}"
SCK_STATUS="not attempted"
FALLBACK_STATUS="not attempted"
VIDEO_METHOD="not captured"
WINDOW_LOG=()
VIDEO_ARTIFACTS=()

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: missing required command: $1" >&2
    exit 1
  fi
}

append_window_log() {
  WINDOW_LOG+=("pane=$1 pid=$2 window=$3")
}

write_intervention_note() {
  local reason="$1"
  mkdir -p "$OUT"
  cat > "$OUT/OPERATOR-INTERVENTION.md" <<EOF
# pd-console visual proof operator intervention

Capture stopped before broad capture.

Reason: $reason

No full-screen capture was attempted. No operator browser, terminal, or
unrelated windows were captured. The harness only targets proof-owned
pd-console windows by launched PID and exact window ID.

Recommended intervention:

1. Ensure a BetterDisplay or dummy-plug virtual display is available.
2. Grant Screen Recording permission to the terminal/app running this harness.
3. Re-run the same command. Do not switch to display-wide or full-screen capture.
EOF
}

fail_intervention() {
  local reason="$1"
  write_intervention_note "$reason"
  echo "error: $reason" >&2
  echo "wrote $OUT/OPERATOR-INTERVENTION.md" >&2
  exit 1
}

write_manifest() {
  mkdir -p "$OUT"
  {
    echo "# pd-console visual proof - $STAMP"
    echo
    echo "Branch: \`$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')\`"
    echo "Commit: \`$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')\`"
    echo "Display selector: \`$DISPLAY_SEL\`"
    echo "Capture owner: proof-owned pd-console window filtered by launched PID."
    echo
    echo "## Receipt"
    echo
    echo "- [RECEIPT.md](./RECEIPT.md)"
    echo
    echo "## Panes"
    for p in $PANES; do
      echo "- \`$p\` - [pane-$p.png](./pane-$p.png)"
    done
    echo
    echo "## Video"
    if [[ " ${VIDEO_ARTIFACTS[*]} " == *" proof.mp4 "* ]]; then
      echo "- [proof.mp4](./proof.mp4)"
    fi
    if [[ " ${VIDEO_ARTIFACTS[*]} " == *" proof.mov "* ]]; then
      echo "- [proof.mov](./proof.mov)"
    fi
    if [[ " ${VIDEO_ARTIFACTS[*]} " == *" proof-window-fallback.mp4 "* ]]; then
      echo "- [proof-window-fallback.mp4](./proof-window-fallback.mp4)"
      echo "- [proof-window-fallback.gif](./proof-window-fallback.gif)"
    fi
    echo
    echo "## Safety"
    echo
    echo "Window-only capture. No full-screen capture. No operator browser,"
    echo "terminal, or unrelated windows."
  } > "$OUT/MANIFEST.md"
}

write_receipt() {
  mkdir -p "$OUT"
  {
    echo "# pd-console visual proof receipt"
    echo
    echo "Artifact dir:"
    echo "\`$OUT\`"
    echo
    echo "## Context"
    echo
    echo "- Branch: \`$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')\`"
    echo "- Commit: \`$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')\`"
    echo "- Daemon URL: \`$DAEMON_URL\`"
    echo "- Display selector: \`$DISPLAY_SEL\`"
    echo "- Source binary: \`$SOURCE_BIN\`"
    echo "- Proof launch binary: \`$BIN\`"
    echo "- Quartz owner name: \`$OWNER_NAME\`"
    echo "- Video mode: \`$VIDEO_MODE\`"
    echo "- Settle delay: \`${SETTLE}s\`"
    echo
    echo "## Safety Contract"
    echo
    echo "- exact-window capture: stills and fallback video frames use \`screencapture -x -o -l\"<windowid>\"\`."
    echo "- Each \`<windowid>\` is discovered from a proof-owned pd-console window launched by this harness."
    echo "- Window discovery is filtered by the launched process PID before capture."
    echo "- No full-screen capture is used."
    echo "- No operator browser, terminal, or unrelated windows are captured."
    echo
    echo "## Artifacts"
    echo
    echo "Screenshots:"
    for p in $PANES; do
      echo "- \`pane-$p.png\`"
    done
    echo
    echo "Video:"
    if [[ "${#VIDEO_ARTIFACTS[@]}" -eq 0 ]]; then
      echo "- not captured"
    else
      for artifact in "${VIDEO_ARTIFACTS[@]}"; do
        echo "- \`$artifact\`"
      done
    fi
    echo
    echo "Supporting evidence:"
    echo "- \`MANIFEST.md\`"
    echo "- \`RECEIPT.md\`"
    [[ "$VIDEO_METHOD" == "screencapture-window-frames" || "$DRY_RUN" == "1" ]] && echo "- \`video-frames/frame-*.png\`"
    [[ -f "$OUT/recorder.log" || "$DRY_RUN" == "1" ]] && echo "- \`recorder.log\`"
    echo
    echo "## Window IDs"
    echo
    if [[ "${#WINDOW_LOG[@]}" -eq 0 ]]; then
      echo "- none recorded"
    else
      for entry in "${WINDOW_LOG[@]}"; do
        echo "- \`$entry\`"
      done
    fi
    echo
    echo "## Commands"
    echo
    echo "Launch proof-owned window:"
    echo
    echo '```sh'
    echo "PORT_DADDY_URL=$DAEMON_URL \"$BIN\" --pane \"<pane>\" --display \"$DISPLAY_SEL\""
    echo '```'
    echo
    echo "Exact-window still capture:"
    echo
    echo '```sh'
    echo 'screencapture -x -o -l"<windowid>" "$OUT/pane-<pane>.png"'
    echo '```'
    echo
    echo "Exact-window fallback video path:"
    echo
    echo '```sh'
    echo 'screencapture -x -o -l"<windowid>" "$OUT/video-frames/frame-001.png"'
    echo 'ffmpeg -y -loglevel error -framerate "$FPS" -i "$OUT/video-frames/frame-%03d.png" \'
    echo '  -vf "scale=1280:852:force_original_aspect_ratio=decrease,pad=1280:852:(ow-iw)/2:(oh-ih)/2" \'
    echo '  -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$OUT/proof-window-fallback.mp4"'
    echo 'ffmpeg -y -loglevel error -i "$OUT/proof-window-fallback.mp4" \'
    echo '  -vf "fps=6,scale=960:-1:flags=lanczos" "$OUT/proof-window-fallback.gif"'
    echo '```'
    echo
    echo "Best-effort ScreenCaptureKit path:"
    echo
    echo '```sh'
    echo '"$REC" --window-id "<windowid>" --duration "$DURATION" --fps "$FPS" --out "$OUT/proof.mov"'
    echo '```'
    echo
    echo "## Method"
    echo
    echo "- ScreenCaptureKit: $SCK_STATUS"
    echo "- Exact-window fallback: $FALLBACK_STATUS"
    echo "- Accepted video method: $VIDEO_METHOD"
    echo
    echo "## Limitations"
    echo
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "- Dry-run receipt only; no GPUI window, screenshot, or video was captured."
    fi
    echo "- Requires a logged-in macOS GUI session for real GPUI capture."
    echo "- Requires Screen Recording permission for window-only \`screencapture\` and ScreenCaptureKit."
    echo "- Requires a virtual display for non-intrusive proof unless \`PD_PROOF_ALLOW_PRIMARY=1\` is explicitly set for local debugging."
  } > "$OUT/RECEIPT.md"
}

if [[ "$DRY_RUN" == "1" ]]; then
  DISPLAY_SEL="${DISPLAY_SEL:-proof-display-dry-run}"
  SCK_STATUS="not attempted in dry-run"
  FALLBACK_STATUS="planned first-class exact-window fallback"
  VIDEO_METHOD="dry-run"
  VIDEO_ARTIFACTS=("proof-window-fallback.mp4" "proof-window-fallback.gif")
  for p in $PANES; do
    append_window_log "$p" "<pid>" "<windowid>"
  done
  write_manifest
  write_receipt
  echo "dry-run proof receipt -> $OUT"
  ls -1 "$OUT"
  exit 0
fi

mkdir -p "$OUT" "$TARGET/proof"
require_cmd cargo
require_cmd screencapture
require_cmd xcrun

if [[ ! -x "$SOURCE_BIN" ]]; then
  echo "building release window (cargo build --release --features gpui)..."
  ( cd "$ROOT" && cargo build --release --features gpui --bin pd-console )
fi
if [[ "$LAUNCH_BIN" != "$SOURCE_BIN" ]]; then
  cp "$SOURCE_BIN" "$LAUNCH_BIN"
  chmod +x "$LAUNCH_BIN"
fi
BIN="$LAUNCH_BIN"
OWNER_NAME="${PD_PROOF_OWNER_NAME:-$(basename "$BIN")}"

if [[ ! -x "$WINID" || "$ROOT/scripts/proof/windowid.swift" -nt "$WINID" ]]; then
  echo "building Quartz window-id helper..."
  xcrun swiftc -O "$ROOT/scripts/proof/windowid.swift" -o "$WINID"
fi

list_displays() {
  "$BIN" --list-displays 2>/dev/null
}

resolve_display() {
  if [[ -n "${PD_PROOF_DISPLAY:-}" ]]; then
    echo "$PD_PROOF_DISPLAY"
    return 0
  fi

  local listing
  listing="$(list_displays)"
  echo "$listing" | sed 's/^/    /' >&2
  local count
  count="$(echo "$listing" | grep -cE '^[[:space:]]*\[')"
  if [[ "$count" -le 1 ]]; then
    if [[ "${PD_PROOF_ALLOW_PRIMARY:-0}" == "1" ]]; then
      echo "warning: only one display found; opening proof window on primary" >&2
      echo "0"
      return 0
    fi
    fail_intervention "No virtual display found. pd-console would open on the physical monitor."
  fi

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
  [[ -n "$idx" ]] || fail_intervention "Could not parse display indexes from pd-console --list-displays."
  echo "$idx"
}

DISPLAY_SEL="$(resolve_display)"
echo "virtual display selector: $DISPLAY_SEL"

windowid() {
  if [[ -n "${APP_PID:-}" ]]; then
    "$WINID" "$OWNER_NAME" --pid "$APP_PID" 2>/dev/null
  else
    "$WINID" "$OWNER_NAME" 2>/dev/null
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

launch_pane() {
  local pane="$1"
  cleanup
  sleep 1
  PORT_DADDY_URL="$DAEMON_URL" "$BIN" --pane "$pane" --display "$DISPLAY_SEL" >/dev/null 2>&1 &
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

capture_still() {
  local pane="$1"
  local id="$2"
  local path="$OUT/pane-$pane.png"
  if screencapture -x -o -l"$id" "$path" && [[ -s "$path" ]]; then
    echo "    ok pane-$pane.png (window $id)"
    return 0
  fi
  fail_intervention "Window-only still capture failed for pane '$pane'. Screen Recording permission may be missing."
}

build_recorder_if_needed() {
  if [[ ! -x "$REC" || "$ROOT/scripts/proof/recorder.swift" -nt "$REC" ]]; then
    echo "building ScreenCaptureKit recorder..."
    xcrun swiftc -O "$ROOT/scripts/proof/recorder.swift" -o "$REC"
  fi
}

capture_sck_video() {
  local id="$1"
  [[ "$VIDEO_MODE" != "screencapture" ]] || {
    SCK_STATUS="skipped by PD_PROOF_VIDEO_MODE=screencapture"
    return 1
  }
  build_recorder_if_needed
  echo "video best-effort ScreenCaptureKit -> $OUT/proof.mov"
  if "$REC" --window-id "$id" --duration "$DURATION" --fps "$FPS" --out "$OUT/proof.mov" \
      >"$OUT/recorder.log" 2>&1 && [[ -s "$OUT/proof.mov" ]]; then
    SCK_STATUS="captured proof.mov"
    VIDEO_METHOD="sck-window"
    VIDEO_ARTIFACTS+=("proof.mov")
    if command -v ffmpeg >/dev/null 2>&1; then
      ffmpeg -y -loglevel error -i "$OUT/proof.mov" \
        -vf "scale='min(1280,iw)':-2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
        "$OUT/proof.mp4"
      [[ -s "$OUT/proof.mp4" ]] && VIDEO_ARTIFACTS+=("proof.mp4")
    fi
    return 0
  fi
  SCK_STATUS="failed or produced no frames; see recorder.log"
  return 1
}

capture_window_frame_video() {
  local id="$1"
  require_cmd ffmpeg
  local frames="$OUT/video-frames"
  rm -rf "$frames"
  mkdir -p "$frames"

  [[ "$DURATION" =~ ^[0-9]+$ ]] || fail_intervention "PD_PROOF_DURATION must be an integer for fallback video."
  [[ "$FPS" =~ ^[0-9]+$ ]] || fail_intervention "PD_PROOF_FPS must be an integer for fallback video."
  local frame_count=$((DURATION * FPS))
  [[ "$frame_count" -gt 0 ]] || fail_intervention "Fallback video needs at least one frame."
  local sleep_interval
  sleep_interval="$(awk -v fps="$FPS" 'BEGIN { printf "%.3f", 1 / fps }')"

  echo "video fallback exact-window frames -> $frames"
  local i frame
  for i in $(seq 1 "$frame_count"); do
    printf -v frame "%s/frame-%03d.png" "$frames" "$i"
    if ! screencapture -x -o -l"$id" "$frame" || [[ ! -s "$frame" ]]; then
      fail_intervention "Window-only fallback frame capture failed at frame $i."
    fi
    sleep "$sleep_interval"
  done

  ffmpeg -y -loglevel error -framerate "$FPS" -i "$frames/frame-%03d.png" \
    -vf "scale=1280:852:force_original_aspect_ratio=decrease,pad=1280:852:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
    "$OUT/proof-window-fallback.mp4"
  [[ -s "$OUT/proof-window-fallback.mp4" ]] || fail_intervention "ffmpeg produced no fallback MP4."

  ffmpeg -y -loglevel error -i "$OUT/proof-window-fallback.mp4" \
    -vf "fps=6,scale=960:-1:flags=lanczos" \
    "$OUT/proof-window-fallback.gif"
  [[ -s "$OUT/proof-window-fallback.gif" ]] || fail_intervention "ffmpeg produced no fallback GIF."

  local unique_count
  unique_count="$(find "$frames" -maxdepth 1 -name 'frame-*.png' -print0 \
    | xargs -0 shasum -a 256 \
    | awk '{print $1}' \
    | sort -u \
    | wc -l \
    | tr -d ' ')"

  FALLBACK_STATUS="captured $frame_count window-only frames ($unique_count unique hashes)"
  VIDEO_METHOD="screencapture-window-frames"
  VIDEO_ARTIFACTS+=("proof-window-fallback.mp4" "proof-window-fallback.gif")
}

echo "stills -> $OUT"
for pane in $PANES; do
  launch_pane "$pane"
  id="$(wait_for_windowid)" || fail_intervention "pd-console window id not found for pane '$pane'."
  append_window_log "$pane" "$APP_PID" "$id"
  sleep "$SETTLE"
  capture_still "$pane" "$id"
done

echo "video pane '$VIDEO_PANE' ($DURATION s @ ${FPS}fps)"
launch_pane "$VIDEO_PANE"
video_id="$(wait_for_windowid)" || fail_intervention "pd-console window id not found for video pane '$VIDEO_PANE'."
append_window_log "$VIDEO_PANE-video" "$APP_PID" "$video_id"
sleep "$SETTLE"

if ! capture_sck_video "$video_id"; then
  capture_window_frame_video "$video_id"
fi

cleanup
write_manifest
write_receipt

if ! compgen -G "$OUT/pane-*.png" >/dev/null; then
  fail_intervention "No pane screenshots were captured."
fi
if [[ "${#VIDEO_ARTIFACTS[@]}" -eq 0 ]]; then
  fail_intervention "No video artifact was captured."
fi

echo "done -> $OUT"
ls -1 "$OUT"
