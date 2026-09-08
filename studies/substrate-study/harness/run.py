"""CLI: run one (corpus, substrate, N, temperament, seed) cell.

    python3 -m harness.run --corpus py-library --substrate C --agents 4 \\
        --temperament cooperative --seed 1 --tasks 600 --out results/

Writes results/<corpus>/<substrate>-N<agents>-<temperament>-s<seed>.csv (one
row) and a sibling `.events.csv` per-task event log. Never hand-edited.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from harness import corpus as corpus_mod
from harness import metrics as metrics_mod
from harness import sim as sim_mod

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RESULT_FIELDS = [
    "corpus", "substrate", "agents", "temperament", "seed",
    "tasks_requested", "tasks_landed", "tasks_abandoned",
    "sim_seconds", "throughput_per_hour", "wasted_lines",
    "conflict_incidents", "time_to_land_median_s", "evidence_completeness",
    "torn_tree_incidents",
    "drop_merges", "drop_binary", "drop_oversize",
]

EVENT_FIELDS = ["time", "event", "agent_id", "task_id", "note"]


def cell_paths(out_dir: str, corpus_name: str, substrate: str, agents: int,
               temperament: str, seed: int) -> tuple:
    d = os.path.join(out_dir, corpus_name)
    base = f"{substrate}-N{agents}-{temperament}-s{seed}"
    return d, os.path.join(d, base + ".csv"), os.path.join(d, base + ".events.csv")


def format_row(corpus_name, substrate, agents, temperament, seed, m, drops) -> dict:
    return {
        "corpus": corpus_name, "substrate": substrate, "agents": agents,
        "temperament": temperament, "seed": seed,
        "tasks_requested": m.tasks_requested, "tasks_landed": m.tasks_landed,
        "tasks_abandoned": m.tasks_abandoned,
        "sim_seconds": f"{m.sim_seconds:.3f}",
        "throughput_per_hour": f"{m.throughput_per_hour:.6f}",
        "wasted_lines": m.wasted_lines,
        "conflict_incidents": m.conflict_incidents,
        "time_to_land_median_s": f"{m.time_to_land_median_s:.3f}",
        "evidence_completeness": f"{m.evidence_completeness:.6f}",
        "torn_tree_incidents": m.torn_tree_incidents,
        "drop_merges": drops.merges, "drop_binary": drops.binary,
        "drop_oversize": drops.oversize,
    }


def write_csv(path: str, fieldnames: list, rows: list) -> None:
    """Atomic, all-or-nothing write: a reader (or an interrupted process)
    never observes a partially written file. Writes to a temp file in the
    SAME directory (so the final os.replace is an atomic rename on the same
    filesystem), fsyncs before closing, then renames over the destination.
    csv's lineterminator="\\n" already ends every row — header and last data
    row alike — with a newline, so a fully written file always ends in one;
    what atomicity buys is that a file is either that, in full, or it does
    not exist yet at `path` at all."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp-", dir=directory)
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, lineterminator="\n")
            w.writeheader()
            for row in rows:
                w.writerow(row)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def run_one(base_dir: str, corpus_name: str, substrate: str, agents: int,
            temperament: str, seed: int, n_tasks: int, out_dir: str,
            changelog_note=lambda msg: None) -> str:
    corpora = corpus_mod.load_corpora(base_dir)
    if corpus_name not in corpora:
        raise SystemExit(f"unknown corpus {corpus_name!r}; choices: {sorted(corpora)}")
    corpus_def = corpora[corpus_name]
    all_tasks, drops = corpus_mod.build_tasks(base_dir, corpus_name, corpus_def, changelog_note)
    if n_tasks > len(all_tasks):
        raise SystemExit(f"--tasks {n_tasks} exceeds {len(all_tasks)} kept tasks "
                          f"for corpus {corpus_name!r}")
    tasks = all_tasks[:n_tasks]

    bare_repo = corpus_mod.ensure_bare_clone(base_dir, corpus_name, corpus_def["repo_url"],
                                              changelog_note)

    cache_root = os.path.join(base_dir, ".cache")
    os.makedirs(cache_root, exist_ok=True)
    run_tmp = tempfile.mkdtemp(prefix=f"s2-{corpus_name}-{substrate}-", dir=cache_root)
    try:
        result = sim_mod.run_cell(base_dir, tasks, substrate, agents, temperament, seed,
                                   run_tmp, bare_repo)
    finally:
        if os.path.isdir(run_tmp):
            import shutil
            shutil.rmtree(run_tmp, ignore_errors=True)

    m = metrics_mod.compute(substrate, result)
    out_subdir, csv_path, events_path = cell_paths(out_dir, corpus_name, substrate, agents,
                                                     temperament, seed)
    row = format_row(corpus_name, substrate, agents, temperament, seed, m, drops)
    write_csv(csv_path, RESULT_FIELDS, [row])
    write_csv(events_path, EVENT_FIELDS, result.events)
    return csv_path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--substrate", required=True, choices=sim_mod.SUBSTRATES)
    ap.add_argument("--agents", type=int, required=True)
    ap.add_argument("--temperament", required=True, choices=["cooperative", "impatient"])
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--tasks", type=int, default=600)
    ap.add_argument("--out", default="results/")
    args = ap.parse_args(argv)

    out_dir = args.out if os.path.isabs(args.out) else os.path.join(BASE_DIR, args.out)

    def changelog_note(msg):
        print(f"[fallback] {msg}", file=sys.stderr)

    path = run_one(BASE_DIR, args.corpus, args.substrate, args.agents, args.temperament,
                    args.seed, args.tasks, out_dir, changelog_note)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
