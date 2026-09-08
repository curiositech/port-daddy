#!/usr/bin/env bash
# Deterministic smoke check for the pd-console visual-proof harness. This does
# not launch GPUI or touch the window server; it verifies the dry-run receipt
# contract that the real capture path must also satisfy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HARNESS="$ROOT/scripts/proof/capture-proof.sh"
VERIFY="$ROOT/scripts/proof/verify-artifacts.mjs"
REAL_SAMPLE_DIR="$ROOT/docs/artifacts/gpui/2026-07-09T19-40-00Z-exact-window-fallback-smoke"
DRY_RUN_SAMPLE_DIR="$ROOT/docs/artifacts/gpui/2026-07-09T19-58-44Z-current-head-dry-run"
INTERVENTION_SAMPLE_DIR="$ROOT/docs/artifacts/gpui/proof-2026-07-09T19-58-44Z-exact-window-fallback-smoke"
DEFAULT_SAMPLE_DIRS="$REAL_SAMPLE_DIR $DRY_RUN_SAMPLE_DIR $INTERVENTION_SAMPLE_DIR"
SAMPLE_DIRS="${PD_PROOF_SAMPLE_DIRS:-${PD_PROOF_SAMPLE_DIR:-$DEFAULT_SAMPLE_DIRS}}"
TMP_ROOT="${TMPDIR:-/tmp}"
OUT="$(mktemp -d "$TMP_ROOT/pd-console-proof-check.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

fail() {
  echo "proof-check: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local needle="$2"
  grep -Fq "$needle" "$file" || fail "$file missing: $needle"
}

expect_verify_fails() {
  local label="$1"
  local dir="$2"
  local safe_label="${label//[^a-zA-Z0-9_-]/-}"
  local log="$OUT/verify-$safe_label.log"
  if node "$VERIFY" "$dir" >"$log" 2>&1; then
    cat "$log" >&2
    fail "verifier accepted invalid fixture: $label"
  fi
}

if ! grep -Fq "PD_PROOF_DRY_RUN" "$HARNESS"; then
  fail "capture-proof.sh has no deterministic dry-run support yet"
fi

PD_PROOF_DRY_RUN=1 \
PD_PROOF_STAMP=2000-01-02T03-04-05Z-check \
PD_PROOF_DISPLAY=proof-display-check \
PD_PROOF_PANES="fleet lane" \
PD_PROOF_VIDEO_PANE=lane \
PD_PROOF_DURATION=2 \
PD_PROOF_FPS=4 \
"$HARNESS" "$OUT" >/dev/null

[[ -s "$OUT/RECEIPT.md" ]] || fail "missing RECEIPT.md"
[[ -s "$OUT/MANIFEST.md" ]] || fail "missing MANIFEST.md"
[[ -f "$VERIFY" ]] || fail "missing verify-artifacts.mjs"

assert_contains "$OUT/RECEIPT.md" "exact-window capture"
assert_contains "$OUT/RECEIPT.md" 'screencapture -x -o -l"<windowid>"'
assert_contains "$OUT/RECEIPT.md" "proof-owned pd-console window"
assert_contains "$OUT/RECEIPT.md" "No full-screen capture"
assert_contains "$OUT/RECEIPT.md" "No operator browser, terminal, or unrelated windows"
assert_contains "$OUT/RECEIPT.md" "pane-fleet.png"
assert_contains "$OUT/RECEIPT.md" "pane-lane.png"
assert_contains "$OUT/RECEIPT.md" "proof-window-fallback.mp4"
assert_contains "$OUT/RECEIPT.md" "proof-window-fallback.gif"
assert_contains "$OUT/MANIFEST.md" "RECEIPT.md"
assert_contains "$OUT/MANIFEST.md" "proof-window-fallback.mp4"

node "$VERIFY" "$OUT"
# shellcheck disable=SC2086 # sample dirs are repo-controlled paths without spaces
node "$VERIFY" $SAMPLE_DIRS

CORRUPT_MEDIA="$OUT/corrupt-media"
cp -R "$REAL_SAMPLE_DIR" "$CORRUPT_MEDIA"
: > "$CORRUPT_MEDIA/pane-lane.png"
: > "$CORRUPT_MEDIA/proof-window-fallback.mp4"
: > "$CORRUPT_MEDIA/proof-window-fallback.gif"
expect_verify_fails "corrupt media" "$CORRUPT_MEDIA"
assert_contains "$OUT/verify-corrupt-media.log" "pane-lane.png is empty"

MISSING_WINDOW_IDS="$OUT/missing-window-ids"
cp -R "$REAL_SAMPLE_DIR" "$MISSING_WINDOW_IDS"
node -e '
const fs = require("node:fs")
const receipt = process.argv[1]
const text = fs.readFileSync(receipt, "utf8")
const next = text.replace(/## Window IDs[\s\S]*?## Commands/, "## Window IDs\n\n- none recorded\n\n## Commands")
fs.writeFileSync(receipt, next)
' "$MISSING_WINDOW_IDS/RECEIPT.md"
expect_verify_fails "missing window ids" "$MISSING_WINDOW_IDS"
assert_contains "$OUT/verify-missing-window-ids.log" "says no Window IDs were recorded"

BROAD_CAPTURE="$OUT/broad-capture"
cp -R "$REAL_SAMPLE_DIR" "$BROAD_CAPTURE"
node -e '
const fs = require("node:fs")
const receipt = process.argv[1]
const text = fs.readFileSync(receipt, "utf8")
const next = text.replace(/screencapture -x -o -l"<windowid>" "\$OUT\/pane-<pane>\.png"/, "screencapture -x \"$OUT/fullscreen.png\"")
fs.writeFileSync(receipt, next)
' "$BROAD_CAPTURE/RECEIPT.md"
expect_verify_fails "broad capture" "$BROAD_CAPTURE"
assert_contains "$OUT/verify-broad-capture.log" "non-window screencapture command"

echo "proof-check: ok"
