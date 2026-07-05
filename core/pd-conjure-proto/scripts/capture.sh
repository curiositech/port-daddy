#!/usr/bin/env bash
# capture.sh — build + run pd-conjure-proto to write the offscreen DAG PNG.
#
# This is the Method-A path: the binary renders the Vello scene to a wgpu texture
# and reads the pixels back to a PNG. There is NO window and NO screencapture, so
# it needs no Screen-Recording / TCC permission and works headless.
#
# Build in RELEASE: on macOS 15+ (Darwin 25) the parley/fontique system-font scan
# trips objc2 0.5.2's debug-only message-signature verification (a spurious
# 'q' vs 'Q' return-encoding check on Core Text's NSFastEnumeration). That check
# is `#[cfg(debug_assertions)]`, so a release build (debug_assertions off) skips
# it and the font scan completes — the message send itself is ABI-correct.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

INPUT="${1:-fixture.json}"
OUTPUT="${2:-conjure-dag-vello.png}"

echo "[capture] building release…"
cargo build --release >/dev/null

echo "[capture] rendering $INPUT -> $OUTPUT (offscreen, no window)…"
./target/release/pd-conjure-proto "$INPUT" "$OUTPUT"

echo "[capture] done:"
ls -la "$OUTPUT"
file "$OUTPUT"
