"""Regenerates PILOT.md's tables from results/py-library/*.csv only.

Standard library, no dependency on the rest of harness/ beyond what's needed
to enumerate the expected pilot grid. Run from studies/substrate-study/:

    python3 -m harness.pilot_summary

Prints two things to stdout:
  1. A completeness report: which of the pilot's expected cells (per
     run.sh --pilot's own PILOT_NS/PILOT_SEEDS/TEMPERAMENTS/SUBSTRATES) are
     present, and which are missing.
  2. One markdown table per substrate: rows are (N, temperament), columns
     are medians across the seeds actually present for that cell (never
     padded to a fixed seed count).

Never writes results/; PILOT.md is filled in by hand from this output so
prose (the H1-H4 notes) stays a human/agent judgment call, not generated
text.
"""
from __future__ import annotations

import csv
import glob
import os
import statistics

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS_DIR = os.path.join(BASE_DIR, "results", "py-library")

# The pilot's own declared grid (run.sh --pilot). Kept here, independent of
# run.sh, so this script can report a cell as *missing* rather than silently
# reflecting whatever happens to be on disk.
SUBSTRATES = ["U", "B0", "B005", "B02", "C", "D", "CR"]
AGENT_COUNTS = [2, 4, 8]
TEMPERAMENTS = ["cooperative", "impatient"]
SEEDS = [1, 2]
EXPECTED_TASKS = 200

NUMERIC_FIELDS = [
    "tasks_landed", "tasks_abandoned", "sim_seconds", "throughput_per_hour",
    "wasted_lines", "conflict_incidents", "time_to_land_median_s",
    "evidence_completeness", "torn_tree_incidents",
]


def load_all() -> dict:
    """(substrate, agents, temperament, seed) -> row dict, for every summary
    CSV under results/py-library/ (siblings *.events.csv skipped)."""
    rows = {}
    for path in sorted(glob.glob(os.path.join(CORPUS_DIR, "*.csv"))):
        if path.endswith(".events.csv"):
            continue
        with open(path, "r", encoding="utf-8", newline="") as f:
            r = list(csv.DictReader(f))
        if not r:
            continue
        row = r[0]
        key = (row["substrate"], int(row["agents"]), row["temperament"], int(row["seed"]))
        rows[key] = row
    return rows


def completeness_report(rows: dict) -> list[str]:
    lines = []
    missing = []
    truncated = []
    for substrate in SUBSTRATES:
        for agents in AGENT_COUNTS:
            for temperament in TEMPERAMENTS:
                for seed in SEEDS:
                    key = (substrate, agents, temperament, seed)
                    if key not in rows:
                        missing.append(key)
                        continue
                    row = rows[key]
                    requested = int(row["tasks_requested"])
                    landed = int(row["tasks_landed"])
                    abandoned = int(row["tasks_abandoned"])
                    if requested != EXPECTED_TASKS:
                        truncated.append(
                            f"{substrate}-N{agents}-{temperament}-s{seed}: "
                            f"tasks_requested={requested}, expected {EXPECTED_TASKS}"
                        )
                    if landed + abandoned != requested:
                        truncated.append(
                            f"{substrate}-N{agents}-{temperament}-s{seed}: "
                            f"landed({landed}) + abandoned({abandoned}) != "
                            f"tasks_requested({requested})"
                        )
    expected_total = len(SUBSTRATES) * len(AGENT_COUNTS) * len(TEMPERAMENTS) * len(SEEDS)
    present_total = expected_total - len(missing)
    lines.append(f"Expected cells: {expected_total} "
                 f"({len(SUBSTRATES)} substrates x {len(AGENT_COUNTS)} N x "
                 f"{len(TEMPERAMENTS)} temperaments x {len(SEEDS)} seeds)")
    lines.append(f"Present: {present_total}/{expected_total}")
    if missing:
        lines.append(f"Missing ({len(missing)}):")
        for (substrate, agents, temperament, seed) in missing:
            lines.append(f"  - {substrate}-N{agents}-{temperament}-s{seed}")
    else:
        lines.append("Missing: none")
    if truncated:
        lines.append(f"Truncated/inconsistent ({len(truncated)}):")
        for t in truncated:
            lines.append(f"  - {t}")
    else:
        lines.append("Truncated/inconsistent: none")
    return lines


def aggregate(rows: dict) -> dict:
    """(substrate, agents, temperament) -> {field: median, 'n_seeds': int,
    'seeds': [int]}, over whatever seeds are actually present. Never
    fabricates a value for a missing seed."""
    groups: dict = {}
    for (substrate, agents, temperament, seed), row in rows.items():
        key = (substrate, agents, temperament)
        groups.setdefault(key, []).append(row)
    out = {}
    for key, rs in groups.items():
        med = {}
        for field in NUMERIC_FIELDS:
            vals = [float(r[field]) for r in rs]
            med[field] = statistics.median(vals)
        med["n_seeds"] = len(rs)
        med["seeds"] = sorted(int(r["seed"]) for r in rs)
        out[key] = med
    return out


def print_tables(agg: dict) -> None:
    headers = ["N", "temperament", "n_seeds", "landed", "abandoned",
               "throughput/hr", "wasted_lines", "conflicts", "ttl_median_s",
               "evidence", "torn"]
    for substrate in SUBSTRATES:
        keys = [k for k in agg if k[0] == substrate]
        if not keys:
            print(f"\n### {substrate}\n\nno data\n")
            continue
        keys.sort(key=lambda k: (k[1], k[2]))
        print(f"\n### {substrate}\n")
        print("| " + " | ".join(headers) + " |")
        print("|" + "---|" * len(headers))
        for k in keys:
            m = agg[k]
            vals = [
                str(k[1]), k[2], str(m["n_seeds"]),
                f"{m['tasks_landed']:.0f}", f"{m['tasks_abandoned']:.0f}",
                f"{m['throughput_per_hour']:.2f}", f"{m['wasted_lines']:.0f}",
                f"{m['conflict_incidents']:.0f}", f"{m['time_to_land_median_s']:.1f}",
                f"{m['evidence_completeness']:.3f}", f"{m['torn_tree_incidents']:.0f}",
            ]
            print("| " + " | ".join(vals) + " |")


def main() -> int:
    rows = load_all()
    print("## Completeness\n")
    for line in completeness_report(rows):
        print(line)
    agg = aggregate(rows)
    print("\n## Medians per (substrate, N, temperament)")
    print_tables(agg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
