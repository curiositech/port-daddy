"""Exactly the five metrics of PROTOCOL.md S2.3, plus the mechanical
torn-tree self-check that runs after every landing regardless of substrate."""
from __future__ import annotations

import statistics
from dataclasses import dataclass

from .sim import CellResult, is_bypass_substrate


@dataclass
class RunMetrics:
    tasks_requested: int
    tasks_landed: int
    tasks_abandoned: int
    sim_seconds: float
    throughput_per_hour: float          # 1. tasks landed per simulated hour
    wasted_lines: int                   # 2. wasted work
    conflict_incidents: int             # 3. conflict incidents (substrate-defined)
    time_to_land_median_s: float        # 4. time to land (median across landed tasks)
    evidence_completeness: float        # 5. evidence completeness
    torn_tree_incidents: int            # mechanical self-check, not one of the 5


def conflict_incidents_for(substrate: str, result: CellResult) -> int:
    """PROTOCOL.md S2.2: refusals (C, CR), merge conflicts (D), torn writes (U, B).

    For B(p) this is refusal_count (its non-bypassed, C-like path) plus
    torn_count (incidents its bypass path can cause): at p=0 that reduces
    exactly to refusal_count, i.e. exactly C's definition, which H3 requires
    for "B(0) and C are indistinguishable on every metric" to be a real,
    falsifiable comparison rather than true-by-metric-construction. Pure U
    never attempts a claim (refusal_count is always 0 for it), so it reduces
    to torn_count alone, matching the table's literal wording for U.
    """
    if substrate == "D":
        return result.merge_conflict_count
    if substrate in ("C", "CR"):
        return result.refusal_count
    if substrate == "U" or is_bypass_substrate(substrate):
        return result.refusal_count + result.torn_count
    raise ValueError(f"unknown substrate {substrate!r}")


def compute(substrate: str, result: CellResult) -> RunMetrics:
    landed_n = len(result.landed)
    hours = result.final_time / 3600.0 if result.final_time > 0 else 0.0
    throughput = (landed_n / hours) if hours > 0 else 0.0
    ttl_values = list(result.time_to_land.values())
    ttl_median = statistics.median(ttl_values) if ttl_values else 0.0
    evidence = (len(result.landed_with_record) / landed_n) if landed_n else 0.0
    return RunMetrics(
        tasks_requested=result.n_tasks,
        tasks_landed=landed_n,
        tasks_abandoned=len(result.abandoned),
        sim_seconds=result.final_time,
        throughput_per_hour=throughput,
        wasted_lines=result.wasted_lines,
        conflict_incidents=conflict_incidents_for(substrate, result),
        time_to_land_median_s=ttl_median,
        evidence_completeness=evidence,
        torn_tree_incidents=result.torn_count,
    )
