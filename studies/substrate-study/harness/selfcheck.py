"""`make check`: a two-agent, ten-task smoke of every substrate on the
smallest corpus. Asserts:
  (1) H1's self-check: zero torn-tree incidents under C, CR, D.
  (2) Determinism: the same seed reproduces the same CSV byte for byte.
  (3) Every committed results/ summary CSV is consistent with its sibling
      events log (catches a truncated or otherwise partial results file
      before it is ever committed again).
Exits nonzero (and prints why) on any failure.
"""
from __future__ import annotations

import csv
import filecmp
import glob
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from harness import run as run_mod
from harness import sim as sim_mod

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = "docs-heavy"   # smallest of the three pinned corpora
AGENTS = 2
TASKS = 10
SEED = 1001


def check_results_consistency() -> list:
    """For every summary CSV under results/, its sibling .events.csv must
    record exactly as many "land" events as the summary's tasks_landed, and
    must not be empty or missing a trailing newline (both symptoms of a
    writer that was interrupted mid-write)."""
    problems = []
    results_dir = os.path.join(BASE_DIR, "results")
    for csv_path in sorted(glob.glob(os.path.join(results_dir, "**", "*.csv"), recursive=True)):
        if csv_path.endswith(".events.csv"):
            continue
        events_path = csv_path[: -len(".csv")] + ".events.csv"
        rel = os.path.relpath(csv_path, BASE_DIR)
        if not os.path.isfile(events_path):
            problems.append(f"{rel}: missing sibling events log {os.path.basename(events_path)}")
            continue
        with open(csv_path, "r", encoding="utf-8", newline="") as f:
            text = f.read()
        if not text.endswith("\n"):
            problems.append(f"{rel}: does not end with a newline (looks truncated)")
        rows = list(csv.DictReader(text.splitlines()))
        if not rows:
            problems.append(f"{rel}: no data row")
            continue
        tasks_landed = int(rows[0]["tasks_landed"])
        with open(events_path, "r", encoding="utf-8", newline="") as f:
            events_text = f.read()
        if not events_text.endswith("\n"):
            problems.append(f"{os.path.relpath(events_path, BASE_DIR)}: does not end with "
                             f"a newline (looks truncated)")
        land_events = [r for r in csv.DictReader(events_text.splitlines()) if r["event"] == "land"]
        if len(land_events) != tasks_landed:
            problems.append(
                f"{rel}: summary says tasks_landed={tasks_landed} but "
                f"{os.path.basename(events_path)} has {len(land_events)} land event(s)"
            )
    return problems


def main() -> int:
    failures: list[str] = []
    tmp_out = tempfile.mkdtemp(prefix="s2-check-")
    try:
        rows = {}
        for substrate in sim_mod.SUBSTRATES:
            path = run_mod.run_one(BASE_DIR, CORPUS, substrate, AGENTS, "cooperative",
                                    SEED, TASKS, tmp_out)
            with open(path, "r", encoding="utf-8") as f:
                header, row = f.read().splitlines()
            rows[substrate] = dict(zip(header.split(","), row.split(",")))
            print(f"  {substrate:5s} landed={rows[substrate]['tasks_landed']:>3} "
                  f"abandoned={rows[substrate]['tasks_abandoned']:>3} "
                  f"torn={rows[substrate]['torn_tree_incidents']:>3} "
                  f"conflicts={rows[substrate]['conflict_incidents']:>4}")

        print("\n[1/3] H1 self-check: zero torn trees under C, CR, D")
        for substrate in ("C", "CR", "D"):
            torn = int(rows[substrate]["torn_tree_incidents"])
            if torn != 0:
                failures.append(
                    f"H1 self-check FAILED for substrate {substrate}: "
                    f"{torn} torn-tree incident(s) (expected 0)"
                )
        if not failures:
            print("      OK")

        print("\n[2/3] determinism: same seed -> byte-identical CSV")
        det_substrate = "C"
        path_a = run_mod.run_one(BASE_DIR, CORPUS, det_substrate, AGENTS, "cooperative",
                                  SEED, TASKS, os.path.join(tmp_out, "det-a"))
        path_b = run_mod.run_one(BASE_DIR, CORPUS, det_substrate, AGENTS, "cooperative",
                                  SEED, TASKS, os.path.join(tmp_out, "det-b"))
        if not filecmp.cmp(path_a, path_b, shallow=False):
            failures.append(f"determinism FAILED: two runs of the same seed "
                             f"({det_substrate}, seed={SEED}) produced different CSVs")
        else:
            events_a, events_b = path_a.replace(".csv", ".events.csv"), path_b.replace(".csv", ".events.csv")
            if not filecmp.cmp(events_a, events_b, shallow=False):
                failures.append("determinism FAILED: event logs differ between identical-seed runs")
            else:
                print("      OK")

        print("\n[3/3] results/ consistency: every summary CSV matches its events log")
        problems = check_results_consistency()
        if problems:
            for p in problems:
                failures.append(f"results consistency FAILED: {p}")
        else:
            print("      OK")
    finally:
        shutil.rmtree(tmp_out, ignore_errors=True)

    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
