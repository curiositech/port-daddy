#!/usr/bin/env python3
"""check_figure_gate_results.py -- gates the whitepaper-build.yml
`figure-gates` CI job: given the fresh figcheck JSON reports it just
produced for this PR's compiled fragments, fails on any T1-T5 failure
unless docs/harbor-research/exposition/figures/blockers.json already
waives that fragment id (same waiver-expiry rule as check_figure_blockers.py,
imported and reused here rather than re-implemented).

This is the CI-time half of the same gate check_figure_blockers.py enforces
against the committed baseline: that script asks "is every KNOWN blocker
waived"; this one asks "does a fragment THIS PR just recompiled introduce a
new, unwaived T1-T5 failure". A fragment compiled clean, or one whose
failure already has an unexpired blockers.json waiver, does not fail the
build -- an unwaived one does, even if blockers.json has never heard of it
(a brand-new figure with a fresh T1-T5 failure is exactly the case this
gate exists to catch before it lands).

Usage:
    python3 scripts/harbor-research/check_figure_gate_results.py \\
        --results-dir /tmp/figure-gate/json

DIR holds one <stem>.json (a `figcheck.py --json` report) per fragment this
CI run compiled and checked.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import check_figure_blockers as cfb  # noqa: E402 (reused: load_blockers, check_blockers waiver-expiry logic)

T1_T5 = ("T1", "T2", "T3", "T4", "T5")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--results-dir", required=True, help="directory of fresh figcheck --json reports")
    parser.add_argument("--as-of", default=None, help=argparse.SUPPRESS)  # YYYY-MM-DD, for tests
    parser.add_argument("--repo-root", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.repo_root:
        cfb.REPO_ROOT = os.path.abspath(args.repo_root)

    as_of = date.today()
    if args.as_of:
        as_of = datetime.strptime(args.as_of, "%Y-%m-%d").date()

    if not os.path.isdir(args.results_dir):
        print(f"FATAL: --results-dir {args.results_dir} does not exist", file=sys.stderr)
        return 1

    try:
        committed = cfb.load_blockers()
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"FATAL: {e}", file=sys.stderr)
        return 1
    waiver_by_id = {b["id"]: b.get("waiver") for b in committed}

    entries = []
    for fname in sorted(os.listdir(args.results_dir)):
        if not fname.endswith(".json"):
            continue
        stem = fname[:-5]
        with open(os.path.join(args.results_dir, fname), encoding="utf-8") as fh:
            rec = json.load(fh)
        failed = [c for c in rec.get("summary", {}).get("failed_checks", []) if c in T1_T5]
        if not failed:
            continue
        entries.append({
            "id": stem,
            "fragment": None,
            "chapter": None,
            "checks_failed": failed,
            "first_seen": as_of.isoformat(),
            "waiver": waiver_by_id.get(stem),
        })

    failures, waived_ok = cfb.check_blockers(entries, as_of)

    print("=" * 78)
    print(
        f"FIGURE GATE: {len(entries)} fragment(s) with a fresh T1-T5 failure, "
        f"{len(waived_ok)} waived, {len(failures)} failure(s)"
    )
    print("=" * 78)
    for eid in waived_ok:
        print(f"  waived: {eid}")
    for f in failures:
        print(f"  {f}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
