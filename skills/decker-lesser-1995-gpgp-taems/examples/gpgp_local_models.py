"""Constructed local checks for the documented GPGP/TAEMS distinctions.

Inputs are validated model records, not untrusted external dictionaries.
These functions model only the stated examples; they are not a GPGP scheduler,
network protocol, or proof of distributed termination.
"""
from __future__ import annotations


def simple_redundancy(qaf: str, methods: list[dict]) -> dict:
    """M3 applies only to equivalent duplicate methods under a MAX parent."""
    if qaf != "MAX":
        return {"status": "NOT_M3", "reason": "simple redundancy requires stated MAX semantics"}
    if not methods or any(not m.get("equivalent_result") for m in methods):
        return {"status": "NOT_M3", "reason": "methods are not exact same-result duplicates"}
    chosen = min(methods, key=lambda m: m["shared_id"])
    return {"status": "CHOOSE_ONE", "method": chosen["shared_id"]}


def relationship_route(kind: str) -> str:
    return {
        "private_view": "M1_NONLOCAL_VIEW",
        "owed_result": "M2_RESULTS",
        "exact_duplicate_MAX": "M3_SIMPLE_REDUNDANCY",
        "enables": "M4_HARD_PREDECESSOR",
        "facilitates": "M5_SOFT_PREDECESSOR",
        "hinders": "UNSUPPORTED_EXTENSION",
    }.get(kind, "NO_SOURCE_MAPPING")


def select_under_constructed_no_violation_policy(candidates: list[dict]) -> dict | None:
    """Constructed strict policy, NOT TR §3.1: validated complete records assumed."""
    feasible = [c for c in candidates if not c.get("violated_commitments")]
    if not feasible:
        return None
    return max(feasible, key=lambda c: (c["estimated_utility"], c.get("negotiable_commitments", 0)))


def local_quiescent(*, idle: bool, expected_communications: set[str], outstanding_commitments: set[str]) -> bool:
    """A local task-group predicate only; expiration/delivery/global semantics are external."""
    return idle and not expected_communications and not outstanding_commitments
