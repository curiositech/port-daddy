#!/usr/bin/env python3
"""Command line for T7, commitment under perturbation.

    python3 t7/cli.py build [--check]             write the sealed materials, or check they reproduce
    python3 t7/cli.py prepare SESSION [--root D]  create the session directory for a subject
    python3 t7/cli.py collect SESSION [--root D] [--reply FILE]
                                                  score a finished session into ../results/SESSION.json
    python3 t7/cli.py dryrun                      run the scripted subjects into ../dryrun/t7.json
    python3 t7/cli.py report                      the table and the verdict over ../results/t7-*.json

Subjects work under the default root in the session scratchpad. The dry run
uses the sibling dry-run root and never touches a subject's directory. Save a
subject's final reply to <root>/SESSION.reply.md before collecting, or pass
its path with --reply.
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

from t7 import controls, design, score, session  # noqa: E402

RESULTS_DIR = HERE.parent / "results"
DRYRUN_DIR = HERE.parent / "dryrun"


def load_results() -> list[dict]:
    return [design.load_json(p)["result"] for p in sorted(RESULTS_DIR.glob("t7-*.json"))]


def cmd_prepare(args) -> int:
    try:
        target = session.prepare(args.session, Path(args.root))
    except (session.SessionError, KeyError) as exc:
        print(exc, file=sys.stderr)
        return 1
    print(target)
    print(session.LAUNCH_LINE.replace("<session dir>", str(target)))
    return 0


def cmd_collect(args) -> int:
    out = RESULTS_DIR / f"{args.session}.json"
    if out.exists() and not args.force:
        print(f"{out} exists; pass --force to score it again", file=sys.stderr)
        return 1
    try:
        result = score.collect(args.session, Path(args.root), Path(args.reply) if args.reply else None)
    except KeyError as exc:
        print(exc, file=sys.stderr)
        return 1
    doc = {"test": "t7", "model": args.model, "scaffold": args.scaffold,
           "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "result": result}
    RESULTS_DIR.mkdir(exist_ok=True)
    design.dump_json(doc, out)
    print(design.dump_json(controls.short(result)), end="")
    print(f"wrote {out}", file=sys.stderr)
    return 0


def cmd_dryrun(args) -> int:
    doc = controls.dryrun(Path(args.root))
    DRYRUN_DIR.mkdir(exist_ok=True)
    design.dump_json(doc, DRYRUN_DIR / "t7.json")
    for agent, pool in doc["pools"].items():
        print(f"== {agent}: expected {pool['expected']}, got {pool['verdict']}")
        print(pool["report"])
        print()
    for name, f in doc["fixtures"].items():
        print(f"fixture {name:<11}{'ok  ' if f['ok'] else 'FAIL'} {f['condition']:<11}-> {f['label']}")
    sim = doc["random_simulation"]
    print(f"random agent, {sim['pools']} simulated pools: {sim['verdicts']}")
    print("controls behave as declared:", doc["controls_behave_as_declared"])
    print("every scripted subject and fixture as expected:", doc["all_ok"])
    return 0 if doc["all_ok"] else 1


def cmd_report(args) -> int:
    results = load_results()
    if not results:
        print(f"no T7 results under {RESULTS_DIR}")
        print("T7 verdict: INCOMPLETE: 0 sessions left a readable record; 14 are needed")
        return 0
    print(score.report(results))
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
    p.add_argument("--reply", help="the subject's final reply; default <root>/SESSION.reply.md")
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
