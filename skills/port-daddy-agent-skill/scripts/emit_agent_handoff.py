#!/usr/bin/env python3
"""Emit a minimal JSON handoff that matches agent-handoff.schema.json."""

from __future__ import annotations

import argparse
import json


def main() -> None:
    parser = argparse.ArgumentParser(description="Emit a Port Daddy agent handoff JSON object.")
    parser.add_argument("--result", required=True)
    parser.add_argument("--file", action="append", default=[], dest="files")
    parser.add_argument("--validation", action="append", default=[])
    parser.add_argument("--risk", action="append", default=[], dest="risks")
    args = parser.parse_args()

    payload = {
        "result": args.result,
        "changedFiles": args.files,
        "validation": [
            {"command": command, "status": "passed"}
            for command in args.validation
        ],
        "remainingRisk": args.risks,
    }
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
