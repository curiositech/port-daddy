#!/usr/bin/env bash
# Deterministic smoke check for the pd-console visual-proof harness. This does
# not launch GPUI or touch the window server; it verifies the dry-run receipt
# contract that the real capture path must also satisfy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HARNESS="$ROOT/scripts/proof/capture-proof.sh"
VERIFY="$ROOT/scripts/proof/verify-artifacts.mjs"
SAMPLE_DIR="${PD_PROOF_SAMPLE_DIR:-$ROOT/docs/artifacts/gpui/2026-07-09T19-40-00Z-exact-window-fallback-smoke}"
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
node "$VERIFY" "$SAMPLE_DIR"

echo "proof-check: ok"
