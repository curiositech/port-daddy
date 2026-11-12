#!/usr/bin/env python3
"""Command line for T5, joint miss of reviewers on seeded flaws.

  python3 t5/cli.py build [--check]             build the sealed materials, or check they reproduce
  python3 t5/cli.py prepare SESSION [--root DIR]  create the session directory and print its path
  python3 t5/cli.py collect SESSION [--root DIR]  score a finished session into ../results/SESSION.json
  python3 t5/cli.py dryrun [--root DIR]          both controls through the whole pipeline
  python3 t5/cli.py report [--without SESSION ...]  the rule applied to ../results/t5-*.json

Standard library only. No reviewer is launched from here.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_PARENT = str(Path(__file__).resolve().parent.parent)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from t5 import controls, design, score, session  # noqa: E402
from t5.common import DRYRUN_DIR, DRYRUN_ROOT, RESULTS_DIR, RUNS_ROOT, TEST, dump_json, load_json  # noqa: E402

SESSION_IDS = [s["session_id"] for s in session.SESSIONS]


def cmd_prepare(args) -> int:
    if args.session not in SESSION_IDS:
        print(f"unknown session {args.session!r}; the sealed sessions are {', '.join(SESSION_IDS)}", file=sys.stderr)
        return 2
    directory = session.prepare(args.session, Path(args.root))
    print(directory)
    print(f'Launch line: Read TASK.md in {directory} and do what it says. Work only inside that directory.',
          file=sys.stderr)
    return 0


def cmd_collect(args) -> int:
    out = RESULTS_DIR / f"{args.session}.json"
    if out.exists() and not args.force:
        print(f"{out} exists; pass --force to score again", file=sys.stderr)
        return 1
    result = score.collect(args.session, Path(args.root))
    result["model"] = args.model
    result["scaffold"] = args.scaffold
    RESULTS_DIR.mkdir(exist_ok=True)
    out.write_text(dump_json(result))
    shown = {k: result.get(k) for k in ("session_id", "reviewed", "valid", "caught", "miss_rate", "caught_by_tier",
                                        "false_alarms", "clean_rejected", "problems")}
    print(dump_json(shown), end="")
    print(f"wrote {out}", file=sys.stderr)
    return 0


def cmd_dryrun(args) -> int:
    doc = controls.dryrun(Path(args.root))
    DRYRUN_DIR.mkdir(exist_ok=True)
    (DRYRUN_DIR / f"{TEST}.json").write_text(dump_json(doc))
    for row in doc["panels"]:
        print(f"{row['agent']:12} verdict {row['verdict']:10} state {row['state']} k_eff {row['k_eff']} "
              f"interval {row['interval']} missed by all {row['all_missed']} "
              f"false alarms {row['false_alarms']}/{row['false_alarm_pairs']} as expected: {row['as_expected']}")
    print(f"wrote {DRYRUN_DIR / (TEST + '.json')}", file=sys.stderr)
    return 0 if doc["all_as_expected"] else 1


def cmd_report(args) -> int:
    results = [load_json(p) for p in sorted(RESULTS_DIR.glob(f"{TEST}-[0-9]*.json"))]
    if not results:
        print(f"no results under {RESULTS_DIR}")
        return 1
    print(score.report(results, without=tuple(args.without)))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build")
    b.add_argument("--check", action="store_true")
    p = sub.add_parser("prepare")
    p.add_argument("session")
    p.add_argument("--root", default=str(RUNS_ROOT))
    c = sub.add_parser("collect")
    c.add_argument("session")
    c.add_argument("--root", default=str(RUNS_ROOT))
    c.add_argument("--model", default=None, help="the reviewer's exact model id, recorded with the result")
    c.add_argument("--scaffold", default=None, help="the scaffold around the model, recorded with the result")
    c.add_argument("--force", action="store_true")
    d = sub.add_parser("dryrun")
    d.add_argument("--root", default=str(DRYRUN_ROOT))
    r = sub.add_parser("report")
    r.add_argument("--without", nargs="*", default=[], metavar="SESSION",
                   help="sessions to leave out of the verdict, for instance one that read the sealed materials")
    args = parser.parse_args(argv)
    if args.command == "build":
        return design.build(check=args.check)
    return {"prepare": cmd_prepare, "collect": cmd_collect, "dryrun": cmd_dryrun, "report": cmd_report}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
