"""Aggregate per-seed result CSVs into medians per (substrate, agents,
temperament), for PILOT.md / REPORT.md. Reads only; never writes results/.
"""
from __future__ import annotations

import argparse
import csv
import glob
import os
import statistics
from collections import defaultdict

NUMERIC_FIELDS = [
    "tasks_landed", "tasks_abandoned", "sim_seconds", "throughput_per_hour",
    "wasted_lines", "conflict_incidents", "time_to_land_median_s",
    "evidence_completeness", "torn_tree_incidents",
]


def load_rows(corpus_dir: str) -> list:
    rows = []
    for path in sorted(glob.glob(os.path.join(corpus_dir, "*.csv"))):
        if path.endswith(".events.csv"):
            continue
        with open(path, "r", encoding="utf-8") as f:
            r = list(csv.DictReader(f))
            if r:
                rows.append(r[0])
    return rows


def aggregate(rows: list) -> dict:
    groups = defaultdict(list)
    for row in rows:
        key = (row["substrate"], int(row["agents"]), row["temperament"])
        groups[key].append(row)
    out = {}
    for key, rs in groups.items():
        med = {}
        for field in NUMERIC_FIELDS:
            vals = [float(r[field]) for r in rs]
            med[field] = statistics.median(vals)
        med["n_seeds"] = len(rs)
        out[key] = med
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus-dir", required=True)
    ap.add_argument("--format", choices=["table", "markdown"], default="markdown")
    args = ap.parse_args()

    rows = load_rows(args.corpus_dir)
    agg = aggregate(rows)

    substrate_order = ["U", "B0", "B005", "B02", "C", "D", "CR"]
    keys = sorted(agg.keys(), key=lambda k: (
        substrate_order.index(k[0]) if k[0] in substrate_order else 99, k[1], k[2]))

    headers = ["substrate", "N", "temperament", "n_seeds", "landed", "abandoned",
               "throughput/hr", "wasted_lines", "conflicts", "ttl_median_s",
               "evidence", "torn"]
    if args.format == "markdown":
        print("| " + " | ".join(headers) + " |")
        print("|" + "---|" * len(headers))
    else:
        print("\t".join(headers))
    for k in keys:
        m = agg[k]
        vals = [
            k[0], str(k[1]), k[2], str(m["n_seeds"]),
            f"{m['tasks_landed']:.0f}", f"{m['tasks_abandoned']:.0f}",
            f"{m['throughput_per_hour']:.2f}", f"{m['wasted_lines']:.0f}",
            f"{m['conflict_incidents']:.0f}", f"{m['time_to_land_median_s']:.1f}",
            f"{m['evidence_completeness']:.3f}", f"{m['torn_tree_incidents']:.0f}",
        ]
        if args.format == "markdown":
            print("| " + " | ".join(vals) + " |")
        else:
            print("\t".join(vals))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
