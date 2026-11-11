#!/usr/bin/env python3
"""Command line for T2, the deterrence dose-response.

    python3 t2/cli.py build [--check]             write the sealed materials, or check they reproduce
    python3 t2/cli.py prepare SESSION [--root D]  create the session directory and print its path
    python3 t2/cli.py collect SESSION [--root D]  score a finished session into ../results/SESSION.json
    python3 t2/cli.py dryrun                      run the controls through the pipeline into ../dryrun/t2.json
    python3 t2/cli.py report                      the table and the verdict over ../results/t2-*.json

Subjects work under the default root in the session scratchpad. The dry run
uses the sibling dry-run root and never touches a subject's directory.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import contextlib
import io
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from t2 import controls, design, kit, score, session  # noqa: E402

TEST = "t2"
RESULTS_DIR = HERE.parent / "results"
DRYRUN_DIR = HERE.parent / "dryrun"


def cmd_prepare(args) -> int:
    try:
        target = session.prepare(args.session, Path(args.root))
    except session.SessionError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(target)
    return 0


def _materials_reproduce() -> bool:
    with contextlib.redirect_stdout(io.StringIO()):
        return design.build(check=True) == 0


def cmd_collect(args) -> int:
    out = Path(args.results_dir) / f"{args.session}.json"
    if out.exists() and not args.force:
        print(f"{out} exists; pass --force to score it again", file=sys.stderr)
        return 1
    try:
        result = score.collect(args.session, Path(args.root))
    except KeyError as exc:
        print(exc, file=sys.stderr)
        return 1
    # The collected record is not a sealed file, so it may carry the time of collection.
    doc = {"model": args.model, "scaffold": args.scaffold,
           "collected_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "materials_reproduce": _materials_reproduce() if args.check_build else None,
           "result": result}
    kit.dump_json(doc, out)
    print(score.report([result]).split("\n\n")[0])
    print(f"wrote {out}", file=sys.stderr)
    return 0


def cmd_dryrun(args) -> int:
    doc = controls.dryrun(Path(args.root) / TEST)
    kit.dump_json(doc, DRYRUN_DIR / f"{TEST}.json")
    for agent, row in doc["controls"].items():
        mark = "as declared" if row["as_declared"] else "NOT AS DECLARED"
        print(f"{agent:18s} declared {row['declared']:5s} got {row['verdict']:10s} {mark}: {row['reason']}")
    print("random benchmark:", doc["random_benchmark"])
    print("maximizer with flipped answers:", {k: f"{v['runs_that_pass']}/{v['simulated_runs']}" for k, v in doc["maximizer_with_flipped_answers"].items()})
    print("controls behave as declared:", doc["controls_behave_as_declared"])
    return 0 if doc["controls_behave_as_declared"] else 1


def cmd_report(args) -> int:
    docs = [kit.load_json(p) for p in sorted(Path(args.results_dir).glob(f"{TEST}-*.json"))]
    if not docs:
        print(f"{TEST}: no collected sessions in {args.results_dir}")
        return 0
    by_model: dict[str, list] = {}
    for d in docs:
        by_model.setdefault(d.get("model") or "model not recorded", []).append(d["result"])
    for model, results in sorted(by_model.items()):
        print(f"model: {model}")
        print(score.report(results))
        print()
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("build")
    p.add_argument("--check", action="store_true")
    p = sub.add_parser("prepare")
    p.add_argument("session")
    p.add_argument("--root", default=str(kit.RUNS_ROOT))
    p = sub.add_parser("collect")
    p.add_argument("session")
    p.add_argument("--root", default=str(kit.RUNS_ROOT))
    p.add_argument("--model", default=None, help="exact model id of the subject; results are reported per model")
    p.add_argument("--scaffold", default="Claude Code subagent (fresh context)")
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-build-check", dest="check_build", action="store_false",
                   help="do not record whether the sealed materials still reproduce")
    p.add_argument("--results-dir", default=str(RESULTS_DIR))
    p = sub.add_parser("dryrun")
    p.add_argument("--root", default=str(kit.DRYRUN_ROOT))
    p = sub.add_parser("report")
    p.add_argument("--results-dir", default=str(RESULTS_DIR))
    args = ap.parse_args(argv)
    if args.cmd == "build":
        return design.build(check=args.check)
    return {"prepare": cmd_prepare, "collect": cmd_collect, "dryrun": cmd_dryrun, "report": cmd_report}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
