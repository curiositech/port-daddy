#!/usr/bin/env bash
# headless-capture.sh — render pd-console's render-agnostic Block model to a real
# PNG with NO window, NO display, and NO Screen-Recording (TCC) permission.
#
# Contrast with capture-proof.sh in this same dir: that one renders the real GPUI
# window onto a BetterDisplay *virtual monitor* and grabs it with screencapture /
# ScreenCaptureKit — needing TCC permission a headless agent shell does not have,
# and a virtual display that is now forbidden to create. THIS script never touches
# the window server, so it is agent-safe and runs on Linux CI too.
#
# It is the Block model, not the GPUI/Metal framebuffer: gpui 0.2.2 exposes no
# offscreen Metal readback. See docs/artifacts/gpui/HEADLESS-CAPTURE.md.
#
# Usage:  scripts/proof/headless-capture.sh [output.png]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"            # core/pd-console
DEFAULT="$ROOT/docs/artifacts/gpui/headless-capture-sample.png"
OUT="${1:-$DEFAULT}"

command -v cargo >/dev/null 2>&1 || { echo "✗ cargo not found" >&2; exit 1; }

# Render + write via the module's test on the CHEAP non-gpui gate (no Metal build,
# seconds). The test writes the deterministic sample to $DEFAULT.
echo "▸ rendering Block model offscreen (non-gpui, no display/TCC)…"
( cd "$ROOT" && cargo test --bin pd-console-repl \
    headless_capture::geom_tests::writes_a_real_console_png -- --nocapture ) \
  | grep -E "wrote |test result" || true

[[ -s "$DEFAULT" ]] || { echo "✗ no PNG produced at $DEFAULT" >&2; exit 1; }

if [[ "$OUT" != "$DEFAULT" ]]; then
  mkdir -p "$(dirname "$OUT")"
  cp "$DEFAULT" "$OUT"
fi

# Validate it is a real, decodable PNG (magic bytes + a size floor).
sig="$(head -c 8 "$OUT" | od -An -tx1 | tr -d ' \n')"
[[ "$sig" == "89504e470d0a1a0a" ]] || { echo "✗ not a PNG (magic=$sig)" >&2; exit 1; }
bytes="$(wc -c < "$OUT" | tr -d ' ')"
[[ "$bytes" -gt 5000 ]] || { echo "✗ PNG too small ($bytes bytes)" >&2; exit 1; }

if command -v sips >/dev/null 2>&1; then
  dims="$(sips -g pixelWidth -g pixelHeight "$OUT" 2>/dev/null | awk '/pixel/{print $2}' | paste -sd x -)"
else
  dims="(install sips/ImageMagick to report dimensions)"
fi

echo "✓ real PNG: $OUT  (${bytes} bytes, ${dims})"
echo "  Provenance: Block-model raster, NOT a GPUI/Metal capture — see"
echo "  docs/artifacts/gpui/HEADLESS-CAPTURE.md"
