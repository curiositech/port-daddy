#!/usr/bin/env python3
"""Print the UDID of the newest available iPhone simulator on this machine.

Used by the `pd-ios` CI job to build an xcodebuild -destination. Pinning a
device name ("iPhone 15") breaks the moment the runner image rotates its
simulators, and pinning nothing at all lets xcodebuild pick something that is
not an iPhone. This picks the highest iOS runtime with an available iPhone and
prints its UDID; it prints nothing and exits 1 when there is none, so the CI
step fails loudly instead of building for the wrong platform.

    xcrun simctl list devices available --json | resolve-simulator-destination.py
"""

import json
import re
import sys


def newest_iphone(payload: dict) -> tuple | None:
    best = None
    for runtime, entries in payload.get("devices", {}).items():
        match = re.search(r"iOS-(\d+)-(\d+)", runtime)
        if not match:
            continue
        version = (int(match.group(1)), int(match.group(2)))
        for device in entries:
            if not device.get("isAvailable"):
                continue
            if "iPhone" not in device.get("name", ""):
                continue
            if best is None or version > best[0]:
                best = (version, device["udid"], device["name"])
    return best


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        print(f"could not parse simctl output: {error}", file=sys.stderr)
        return 1

    best = newest_iphone(payload)
    if best is None:
        print("no available iPhone simulator on this machine", file=sys.stderr)
        return 1

    version, udid, name = best
    print(udid)
    print(f"selected {name} on iOS {version[0]}.{version[1]} ({udid})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
