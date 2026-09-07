"""`make check`: a two-agent, ten-task smoke of every substrate on the
smallest corpus. Asserts:
  (1) H1's self-check: zero torn-tree incidents under C, CR, D.
  (2) Determinism: the same seed reproduces the same CSV byte for byte.
Exits nonzero (and prints why) on any failure.
"""
from __future__ import annotations

import filecmp
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

        print("\n[1/2] H1 self-check: zero torn trees under C, CR, D")
        for substrate in ("C", "CR", "D"):
            torn = int(rows[substrate]["torn_tree_incidents"])
            if torn != 0:
                failures.append(
                    f"H1 self-check FAILED for substrate {substrate}: "
                    f"{torn} torn-tree incident(s) (expected 0)"
                )
        if not failures:
            print("      OK")

        print("\n[2/2] determinism: same seed -> byte-identical CSV")
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
