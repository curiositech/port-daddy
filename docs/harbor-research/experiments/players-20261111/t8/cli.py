#!/usr/bin/env python3
"""Command line for T8, stated against revealed behaviour.

    python3 t8/cli.py build [--check]             write the sealed materials, or check they reproduce
    python3 t8/cli.py prepare SESSION [--root D]  create the session directory for a subject
    python3 t8/cli.py collect SESSION [--root D]  score a finished session into ../results/SESSION.json
    python3 t8/cli.py dryrun                      run the scripted subjects into ../dryrun/t8.json
    python3 t8/cli.py report                      stated against revealed over ../results/, and the verdict

`report` reads the questionnaires from ../results/t8-*.json, T7's sessions
from ../results/t7-*.json, and the checkout repair labels from the earlier
run's result files. Until T7's results exist it prints INCOMPLETE.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from t8 import controls, design, score, session  # noqa: E402

RESULTS_DIR = HERE.parent / "results"
DRYRUN_DIR = HERE.parent / "dryrun"


def cmd_prepare(args) -> int:
    try:
        target = session.prepare(args.session, Path(args.root))
    except session.SessionError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(target)
    print(session.LAUNCH_LINE.replace("<session dir>", str(target)))
    return 0


def cmd_collect(args) -> int:
    if args.session not in design.SESSION_IDS:
        print(f"unknown T8 session {args.session!r}", file=sys.stderr)
        return 1
    out = RESULTS_DIR / f"{args.session}.json"
    if out.exists() and not args.force:
        print(f"{out} exists; pass --force to score it again", file=sys.stderr)
        return 1
    result = score.collect(args.session, Path(args.root))
    doc = {"test": "t8", "model": args.model, "scaffold": args.scaffold,
           "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "result": result}
    RESULTS_DIR.mkdir(exist_ok=True)
    design.dump_json(doc, out)
    print(f"{args.session}: answered {result['answered']} of {result['n_items']}; "
          f"complete: {result['complete']}; problems: {result['problems'] or 'none'}")
    print(f"wrote {out}", file=sys.stderr)
    return 0


def cmd_dryrun(args) -> int:
    doc = controls.dryrun(Path(args.root))
    DRYRUN_DIR.mkdir(exist_ok=True)
    design.dump_json(doc, DRYRUN_DIR / "t8.json")
    for agent, pool in doc["pools"].items():
        print(f"== {agent}: without T7 results {pool['without_t7']['verdict']} "
              f"(expected {pool['without_t7']['expected']}); against the stand-in "
              f"{pool['with_standin_t7']['verdict']} (expected {pool['with_standin_t7']['expected']})")
        if agent in ("scripted", "random"):
            print(pool["report_with_standin_t7"])
        print()
    sim = doc["random_simulation"]
    print(f"random agent, {sim['pools']} simulated pools against the stand-in: {sim['verdicts']}; classes with a "
          f"different most common action: median {sim['classes_with_a_different_most_common_action']['median']}")
    print("stand-in equals T7's dry run of its maximizer:", doc["standin_matches_t7_dryrun"])
    print("controls behave as declared:", doc["controls_behave_as_declared"])
    print("every scripted subject as expected:", doc["all_ok"])
    return 0 if doc["all_ok"] else 1


def cmd_report(args) -> int:
    docs = [design.load_json(p) for p in sorted(RESULTS_DIR.glob("t8-*.json"))]
    print(score.report([d["result"] for d in docs], score.load_t7_results(RESULTS_DIR)))
    outside = [d["result"]["session_id"] for d in docs if d.get("read_outside_its_directory")]
    if outside:
        print("the runner's trace has these subjects naming a path outside their directory: " + ", ".join(outside))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("build")
    p.add_argument("--check", action="store_true")
    p = sub.add_parser("prepare")
    p.add_argument("session")
    p.add_argument("--root", default=str(design.RUNS_ROOT))
    p = sub.add_parser("collect")
    p.add_argument("session")
    p.add_argument("--root", default=str(design.RUNS_ROOT))
    p.add_argument("--model", help="the subject's exact model id")
    p.add_argument("--scaffold", default="Claude Code subagent (fresh context)")
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("dryrun")
    p.add_argument("--root", default=str(design.DRYRUN_ROOT))
    sub.add_parser("report")
    args = ap.parse_args(argv)
    if args.cmd == "build":
        return design.build(args.check)
    return {"prepare": cmd_prepare, "collect": cmd_collect, "dryrun": cmd_dryrun, "report": cmd_report}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
