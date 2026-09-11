#!/usr/bin/env bash
#
# Boot the real PortDaddy iOS app in a simulator and capture one screenshot per
# root tab. This is the automated visual-evidence mechanism for apps/pd-ios.
#
# WHY THIS EXISTS, AND WHY IT IS NOT THE SwiftPM GATE
# ---------------------------------------------------
# apps/pd-ios ships as a SwiftPM library (Package.swift). `swift build` cannot
# emit an iOS .app, and the `pd-ios` CI job only proves PortDaddyKit *compiles
# and its XCTests pass* against a simulator SDK — it never renders the UI and
# never compiles App/PortDaddyApp.swift (the @main shim). So "the tests are
# green" has never meant "the app runs". This script closes that gap: it
# assembles a runnable app target with XcodeGen *ephemerally* (the generated
# PortDaddy.xcodeproj is git-ignored, never committed — the repo's checked-in
# contract stays "no .xcodeproj, no XcodeGen"), links the library, drives all
# four RootTab cases through an XCUITest, and exports a named PNG per tab.
#
# Run locally:   apps/pd-ios/scripts/capture-screenshots.sh
# Output:        apps/pd-ios/pd-ios-screenshots/{01-roadmap,02-harbors,03-asks,04-controls}.png
#
# It is deterministic and offline: RootView is fixture-backed by default, so a
# cold launch renders real content with no network, pairing, or auth.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

OUT_DIR="${1:-$HERE/pd-ios-screenshots}"
RESULT_BUNDLE="$HERE/.screenshots.xcresult"

echo "==> Resolving newest available iPhone simulator"
UDID="$(xcrun simctl list devices available --json | python3 scripts/resolve-simulator-destination.py | head -1)"
if [[ -z "${UDID:-}" ]]; then
  echo "error: no available iPhone simulator" >&2
  exit 1
fi
echo "    UDID=$UDID"

echo "==> Generating the ephemeral Xcode app target (xcodegen)"
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "error: xcodegen not found. Install with: brew install xcodegen" >&2
  exit 1
fi
xcodegen generate >/dev/null

echo "==> Booting simulator"
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true

echo "==> Building app + UI test and running the capture (xcodebuild test)"
rm -rf "$RESULT_BUNDLE"
xcodebuild test \
  -project PortDaddy.xcodeproj \
  -scheme PortDaddy \
  -destination "platform=iOS Simulator,id=$UDID" \
  -resultBundlePath "$RESULT_BUNDLE" \
  CODE_SIGNING_ALLOWED=NO \
  >/dev/null

echo "==> Exporting screenshots from the result bundle"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
xcrun xcresulttool export attachments \
  --path "$RESULT_BUNDLE" \
  --output-path "$OUT_DIR" >/dev/null

python3 - "$OUT_DIR" <<'PY'
import json, os, re, shutil, sys
out = sys.argv[1]
manifest = os.path.join(out, "manifest.json")
if not os.path.exists(manifest):
    print("error: no manifest.json produced by xcresulttool", file=sys.stderr)
    sys.exit(1)
count = 0
for entry in json.load(open(manifest)):
    for a in entry.get("attachments", []):
        src = os.path.join(out, a["exportedFileName"])
        human = a.get("suggestedHumanReadableName", a["exportedFileName"])
        base = re.sub(r"_\d+_[0-9A-Fa-f-]+\.png$", ".png", human)
        if os.path.exists(src):
            shutil.move(src, os.path.join(out, base))
            count += 1
print(f"    exported {count} screenshot(s) -> {out}")
if count == 0:
    sys.exit(1)
PY

echo "==> Done. Screenshots:"
ls -1 "$OUT_DIR"/[0-9][0-9]-*.png
