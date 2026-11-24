#!/usr/bin/env bash
#
# Boot the real Port Daddy iOS app in an approved hosted simulator and capture
# its disconnected and sample states in light/dark at default size and AX5.
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
# contract stays generated-project-free), links the library, and exports
# fixture-only XCUITest attachments. Do not run this on an operator-halted Mac.
#
# Hosted entry: apps/pd-ios/scripts/capture-screenshots.sh
# Output:       apps/pd-ios/pd-ios-screenshots/{01-relay,02-sample-inbox,…}-<variant>.png
#
# No network, pairing, or auth: the test never opens the browser handoff.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

OUT_DIR="${1:-$HERE/pd-ios-screenshots}"
RESULT_BUNDLE="$HERE/.screenshots.xcresult"

echo "==> Resolving newest available iPhone simulator"
SIMULATORS="$(xcrun simctl list devices available --json)"
UDID="$(printf '%s' "$SIMULATORS" | python3 scripts/resolve-simulator-destination.py | head -1)"
if [[ -z "${UDID:-}" ]]; then
  echo "error: no available iPhone simulator" >&2
  exit 1
fi
echo "    UDID=$UDID"
printf '%s' "$SIMULATORS" | python3 -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for device in devices:
        if device["udid"] == sys.argv[1]:
            print("    Device=%s runtime=%s" % (device["name"], runtime))
            sys.exit(0)
sys.exit("selected simulator not found in inventory")
' "$UDID"

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
xcodebuild -quiet test \
  -project PortDaddy.xcodeproj \
  -scheme PortDaddy \
  -destination "platform=iOS Simulator,id=$UDID" \
  -resultBundlePath "$RESULT_BUNDLE" \
  CODE_SIGNING_ALLOWED=NO

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
expected = {
    f"{screen}-{variant}.png"
    for screen in ("01-relay", "02-sample-inbox", "03-sample-expired", "04-sample-harbors", "05-sample-stale")
    for variant in ("light", "dark", "light-ax5", "dark-ax5")
}
found = set()
for entry in json.load(open(manifest)):
    for a in entry.get("attachments", []):
        src = os.path.join(out, a["exportedFileName"])
        human = a.get("suggestedHumanReadableName", a["exportedFileName"])
        base = re.sub(r"_\d+_[0-9A-Fa-f-]+\.png$", ".png", human)
        if base in expected and os.path.isfile(src):
            shutil.move(src, os.path.join(out, base))
            found.add(base)
print(f"    exported {len(found)} fixture screenshot(s) -> {out}")
if expected != found:
    print("error: missing fixture screenshots: " + ", ".join(sorted(expected - found)), file=sys.stderr)
    sys.exit(1)
PY

echo "==> Done. Screenshots:"
ls -1 "$OUT_DIR"/[0-9][0-9]-*.png
