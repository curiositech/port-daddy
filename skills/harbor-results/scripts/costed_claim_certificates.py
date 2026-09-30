"""Exact minimum-cost contradictions in already observed categorical differences.

Prices are nonnegative integer costs per distinct reciprocal edge observation.
This is retrospective evidence selection, not acquisition of unknown answers.
No numeric dependency, network access, or side effects on import.
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import json
from pathlib import Path
from typing import Any


def _validate(rows: list[dict], costs: dict[tuple[str, str], int]) -> None:
    if not isinstance(rows, list) or not isinstance(costs, dict):
        raise ValueError("differences must be a list and costs an edge-keyed dictionary")
    context = None
    edges: set[tuple[str, str]] = set()
    receipts: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("each difference must be an object")
        for key in ("fact", "snapshot"):
            if not isinstance(row.get(key), str) or not row[key]:
                raise ValueError(f"nonempty {key} required")
        row_context = row["fact"], row["snapshot"]
        if context is not None and context != row_context:
            raise ValueError("one fact and snapshot are required")
        context = row_context
        edge = row.get("edge")
        if (not isinstance(edge, list) or len(edge) != 2
                or any(not isinstance(v, str) or not v for v in edge)
                or edge[0] >= edge[1] or tuple(edge) in edges):
            raise ValueError("edges must be distinct canonical pairs of different vertices")
        edges.add(tuple(edge))
        ids = row.get("receipts")
        if (not isinstance(ids, list) or len(ids) != 2
                or any(not isinstance(r, str) or not r for r in ids)
                or ids[0] == ids[1] or any(r in receipts for r in ids)):
            raise ValueError("each difference requires two distinct, unshared receipt IDs")
        receipts.update(ids)
        base = {"fact", "snapshot", "edge", "kind", "receipts"}
        if row.get("kind") == "signed":
            if (set(row) != base | {"tail", "head"}
                    or any(not isinstance(row.get(k), str) or not row[k]
                           for k in ("tail", "head"))
                    or row["tail"] == row["head"]):
                raise ValueError("signed rows require exactly two different endpoint values")
        elif row.get("kind") != "zero" or set(row) != base:
            raise ValueError("zero rows must not contain erased endpoint values")
    if set(costs) != edges or any(type(w) is not int or w < 0 for w in costs.values()):
        raise ValueError("provide one nonnegative integer cost for every difference edge")


def _input_digest(differences: list[dict], costs: dict[tuple[str, str], int]) -> str:
    encoded = json.dumps({"differences": differences,
                          "costs": [[list(edge), cost] for edge, cost in sorted(costs.items())]},
                         sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def minimum_certificate(differences: list[dict], costs: dict[tuple[str, str], int]) -> dict:
    """Return a minimum-cost infeasible subset, or cost=None when feasible.

    `differences` uses claim_audit's sanitized per-fact format. Output contains
    indexes into that exact input, two pinned vertices/values and an oriented
    zero-edge walk. A content digest binds the exact input rows and prices;
    neither that digest nor index references authenticate the evidence source.
    Proof: claim-evidence-audit.md, minimum-cost retained-evidence theorem.
    """
    _validate(differences, costs)
    adjacency: dict[str, list[tuple[str, int, int]]] = {}
    pins: list[tuple[str, str, int]] = []
    for i, row in enumerate(differences):
        u, v = row["edge"]
        adjacency.setdefault(u, [])
        adjacency.setdefault(v, [])
        if row["kind"] == "zero":
            weight = costs[u, v]
            adjacency[u].append((v, weight, i))
            adjacency[v].append((u, weight, i))
        else:
            pins.extend(((u, row["tail"], i), (v, row["head"], i)))
    for neighbors in adjacency.values():
        neighbors.sort()

    def shortest_paths(start: str) -> tuple[dict[str, int], dict[str, tuple[str, int]]]:
        distance, previous = {start: 0}, {}
        queue = [(0, start)]
        while queue:
            d, u = heapq.heappop(queue)
            if d != distance[u]:
                continue
            for v, weight, index in adjacency[u]:
                candidate = d + weight
                if v not in distance or candidate < distance[v]:
                    distance[v] = candidate
                    previous[v] = u, index
                    heapq.heappush(queue, (candidate, v))
        return distance, previous

    best = None
    best_path: list[int] = []
    best_pins: tuple[tuple[str, str, int], tuple[str, str, int]] | None = None
    # One source at a time bounds auxiliary shortest-path storage to O(V+E).
    # We may repeat a source for its distinct pins; at most 2m searches.
    for i, p in enumerate(pins):
        distance, previous = shortest_paths(p[0])
        for j in range(i + 1, len(pins)):
            q = pins[j]
            if p[1] == q[1] or q[0] not in distance:
                continue
            source_edges = {p[2], q[2]}
            value = distance[q[0]] + sum(costs[tuple(differences[k]["edge"])]
                                           for k in source_edges)
            candidate = value, i, j
            if best is not None and candidate >= best:
                continue
            cursor, path = q[0], []
            while cursor != p[0]:
                cursor, index = previous[cursor]
                path.append(index)
            best, best_path, best_pins = candidate, list(reversed(path)), (p, q)
    if best_pins is None:
        return {"status": "feasible", "input_digest": _input_digest(differences, costs),
                "cost": None, "edge_indices": [],
                "pins": [], "zero_path": []}
    chosen = sorted(set(best_path) | {p[2] for p in best_pins})
    return {"status": "infeasible", "input_digest": _input_digest(differences, costs),
            "cost": best[0], "edge_indices": chosen,
            "pins": [{"vertex": p[0], "value": p[1], "edge_index": p[2]}
                     for p in best_pins], "zero_path": best_path}


def verify_selection(differences: list[dict], costs: dict[tuple[str, str], int],
                     result: dict) -> bool:
    """Check an infeasibility witness and its price, not its global optimality.

    Does not invoke minimum_certificate or any feasibility solver.
    """
    try:
        _validate(differences, costs)
        if not isinstance(result, dict) or result.get("status") != "infeasible":
            return False
        if result.get("input_digest") != _input_digest(differences, costs):
            return False
        pins, path, chosen = result["pins"], result["zero_path"], result["edge_indices"]
        if not isinstance(pins, list) or len(pins) != 2:
            return False
        if not isinstance(path, list) or not isinstance(chosen, list):
            return False
        indices = path + chosen + [p["edge_index"] for p in pins]
        if any(type(i) is not int or not 0 <= i < len(differences) for i in indices):
            return False
        for p in pins:
            row = differences[p["edge_index"]]
            if row["kind"] != "signed" or p["vertex"] not in row["edge"]:
                return False
            expected = row["tail"] if p["vertex"] == row["edge"][0] else row["head"]
            if p["value"] != expected:
                return False
        if pins[0]["value"] == pins[1]["value"]:
            return False
        cursor = pins[0]["vertex"]
        for i in path:
            row = differences[i]
            if row["kind"] != "zero" or cursor not in row["edge"]:
                return False
            u, v = row["edge"]
            cursor = v if cursor == u else u
        if cursor != pins[1]["vertex"]:
            return False
        if chosen != sorted(set(path) | {p["edge_index"] for p in pins}):
            return False
        return (type(result["cost"]) is int
                and result["cost"] == sum(costs[tuple(differences[i]["edge"])] for i in chosen))
    except (ValueError, TypeError, KeyError, IndexError):
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path,
                        help="JSON with sanitized differences and [{edge:[u,v],cost:int}]")
    args = parser.parse_args()
    try:
        data: Any = json.loads(args.input.read_text())
        if not isinstance(data, dict) or set(data) != {"differences", "costs"}:
            raise ValueError("input requires differences and costs")
        if not isinstance(data["costs"], list):
            raise ValueError("costs must be a list")
        prices = {}
        for price in data["costs"]:
            if not isinstance(price, dict) or set(price) != {"edge", "cost"}:
                raise ValueError("each price requires edge and cost")
            edge = price["edge"]
            if (not isinstance(edge, list) or len(edge) != 2
                    or any(not isinstance(v, str) for v in edge) or tuple(edge) in prices):
                raise ValueError("cost edges must be distinct vertex pairs")
            prices[tuple(edge)] = price["cost"]
        print(json.dumps(minimum_certificate(data["differences"], prices), sort_keys=True))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        parser.exit(2, f"invalid evidence: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
