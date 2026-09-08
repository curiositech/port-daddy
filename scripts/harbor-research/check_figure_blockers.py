#!/usr/bin/env python3
"""check_figure_blockers.py -- fails if any entry in
docs/harbor-research/exposition/figures/blockers.json is unwaived, or if its
waiver has expired.

Stdlib-only. This is the release gate half of the mechanical-failure-as-
blocker deliverable: `render_figure_audit.py --write` computes blockers.json
from the figcheck records; this script is the thing CI actually runs to
decide whether the T1-T5 backlog is acceptable today. It does not
regenerate blockers.json (run render_figure_audit.py --check for staleness)
and it does not touch any TikZ fragment -- it only reads the committed JSON.

A blocker is unwaived (fails) unless its `waiver` is a non-null object with
a `reason` and an `expires` date (YYYY-MM-DD) that has not yet passed, as of
--as-of (default: today, UTC-naive `date.today()`).

Usage:
    python3 scripts/harbor-research/check_figure_blockers.py [--verbose]

Exit status: 0 iff blockers.json parses and every entry is either absent,
or waived with a future (or today's) expiry. 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLOCKERS_REL = "docs/harbor-research/exposition/figures/blockers.json"

REQUIRED_ENTRY_KEYS = ("id", "fragment", "chapter", "checks_failed", "first_seen", "waiver")
REQUIRED_WAIVER_KEYS = ("reason", "expires")


def abspath(rel_path: str) -> str:
    return os.path.join(REPO_ROOT, rel_path)


def load_blockers() -> list[dict]:
    path = abspath(BLOCKERS_REL)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"{BLOCKERS_REL} does not exist")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError(f"{BLOCKERS_REL}: top level must be a list")
    return data


def check_blockers(blockers: list[dict], as_of: date) -> tuple[list[str], list[str]]:
    """Returns (failures, waived_ok) -- waived_ok is the ids that are
    legitimately waived, for --verbose reporting."""
    failures: list[str] = []
    waived_ok: list[str] = []
    seen_ids: set[str] = set()

    for i, entry in enumerate(blockers):
        for key in REQUIRED_ENTRY_KEYS:
            if key not in entry:
                failures.append(f"{BLOCKERS_REL}[{i}]: missing required key '{key}'")
        eid = entry.get("id", f"<entry {i}>")
        if eid in seen_ids:
            failures.append(f"{BLOCKERS_REL}: duplicate blocker id '{eid}'")
        seen_ids.add(eid)

        checks_failed = entry.get("checks_failed")
        if not isinstance(checks_failed, list) or not checks_failed:
            failures.append(f"{BLOCKERS_REL}: entry '{eid}' has empty/invalid checks_failed")

        waiver = entry.get("waiver")
        if waiver is None:
            failures.append(
                f"{BLOCKERS_REL}: '{eid}' fails {checks_failed} and carries no waiver"
            )
            continue

        if not isinstance(waiver, dict):
            failures.append(f"{BLOCKERS_REL}: '{eid}' waiver must be null or an object")
            continue
        missing = [k for k in REQUIRED_WAIVER_KEYS if k not in waiver]
        if missing:
            failures.append(f"{BLOCKERS_REL}: '{eid}' waiver is missing {missing}")
            continue
        try:
            expires = datetime.strptime(waiver["expires"], "%Y-%m-%d").date()
        except ValueError:
            failures.append(
                f"{BLOCKERS_REL}: '{eid}' waiver.expires '{waiver['expires']}' is not YYYY-MM-DD"
            )
            continue
        if expires < as_of:
            failures.append(
                f"{BLOCKERS_REL}: '{eid}' waiver expired {waiver['expires']} "
                f"(reason: {waiver.get('reason', '?')}) -- as of {as_of.isoformat()}"
            )
            continue
        waived_ok.append(eid)

    return failures, waived_ok


def main() -> int:
    global REPO_ROOT
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true", help="list waived-ok entries too")
    parser.add_argument("--as-of", default=None, help=argparse.SUPPRESS)  # YYYY-MM-DD, for tests
    parser.add_argument("--repo-root", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.repo_root:
        REPO_ROOT = os.path.abspath(args.repo_root)

    as_of = date.today()
    if args.as_of:
        as_of = datetime.strptime(args.as_of, "%Y-%m-%d").date()

    try:
        blockers = load_blockers()
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"FATAL: {e}", file=sys.stderr)
        return 1

    failures, waived_ok = check_blockers(blockers, as_of)

    print("=" * 78)
    print(f"FIGURE BLOCKERS: {len(blockers)} total, {len(waived_ok)} waived, {len(failures)} failure(s)")
    print("=" * 78)
    if args.verbose:
        for eid in waived_ok:
            print(f"  waived: {eid}")
    for f in failures:
        print(f"  {f}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
