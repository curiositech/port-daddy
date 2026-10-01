#!/usr/bin/env python3
"""Offline audit of finite-valued, snapshot-bound directed claim receipts.

Only reciprocal observations yield a signed difference. The categorical checker
decides feasibility of those differences, not whether any statement is true.
Raw directed receipts are also checked separately for sender inconsistency.
"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import json
import math
import sys
from typing import Any


class InputError(ValueError):
    """The supplied observation document violates the offline contract."""


MAX_JSON_BYTES = 16 * 1024 * 1024


def _string(value: Any, where: str) -> str:
    if type(value) is not str or not value:
        raise InputError(f"{where} must be a nonempty string")
    return value


def _exact_keys(value: Any, keys: set[str], where: str) -> dict:
    if type(value) is not dict or set(value) != keys:
        raise InputError(f"{where} must have exactly {sorted(keys)}")
    return value


def _parse(data: Any) -> tuple[str, dict[str, list[str]], list[str], list[tuple[str, str]], list[dict]]:
    document = _exact_keys(data, {"snapshot", "facts", "agents", "edges", "messages"}, "document")
    snapshot = _string(document["snapshot"], "snapshot")
    raw_facts = document["facts"]
    if type(raw_facts) is not dict or not raw_facts or len(raw_facts) > 128:
        raise InputError("facts must be a nonempty object of at most 128 facts")
    facts: dict[str, list[str]] = {}
    for fact, raw_values in raw_facts.items():
        _string(fact, "fact ID")
        if type(raw_values) is not list or not raw_values or len(raw_values) > 4096:
            raise InputError(f"facts[{fact}] must be a nonempty value list of at most 4096")
        values = [_string(v, f"facts[{fact}] value") for v in raw_values]
        if len(set(values)) != len(values):
            raise InputError(f"facts[{fact}] has duplicate values")
        facts[fact] = values
    raw_agents = document["agents"]
    if type(raw_agents) is not list or not raw_agents or len(raw_agents) > 10000:
        raise InputError("agents must be a nonempty list of at most 10000")
    agents = [_string(a, "agent ID") for a in raw_agents]
    if len(set(agents)) != len(agents):
        raise InputError("duplicate agent ID")
    agent_set = set(agents)
    raw_edges = document["edges"]
    if type(raw_edges) is not list or len(raw_edges) > 4096:
        raise InputError("edges must be a list of at most 4096 pairs")
    edges: list[tuple[str, str]] = []
    for index, pair in enumerate(raw_edges):
        if type(pair) is not list or len(pair) != 2 or any(type(x) is not str for x in pair):
            raise InputError(f"edges[{index}] must be a pair of agent IDs")
        u, v = pair
        if u not in agent_set or v not in agent_set or u == v:
            raise InputError(f"edges[{index}] has unknown endpoint or self-loop")
        edges.append(tuple(sorted((u, v))))
    if len(set(edges)) != len(edges):
        raise InputError("duplicate undirected edge")
    edges.sort()
    edge_set = set(edges)
    raw_messages = document["messages"]
    if type(raw_messages) is not list or len(raw_messages) > 65536:
        raise InputError("messages must be a list of at most 65536 records")
    receipts: dict[str, dict] = {}
    directed: dict[tuple[str, str, str], tuple[str, list[str]]] = {}
    for index, raw in enumerate(raw_messages):
        msg = _exact_keys(raw, {"receipt", "snapshot", "fact", "value", "sender", "receiver"}, f"messages[{index}]")
        for key, value in msg.items():
            _string(value, f"messages[{index}].{key}")
        if msg["snapshot"] != snapshot:
            raise InputError(f"messages[{index}] has a stale snapshot")
        if msg["fact"] not in facts or msg["value"] not in facts[msg["fact"]]:
            raise InputError(f"messages[{index}] has unknown fact or value")
        if tuple(sorted((msg["sender"], msg["receiver"]))) not in edge_set or msg["sender"] == msg["receiver"]:
            raise InputError(f"messages[{index}] has an unknown directed edge")
        receipt = msg["receipt"]
        if receipt in receipts:
            if receipts[receipt] != msg:
                raise InputError(f"receipt {receipt} has conflicting records")
            continue
        receipts[receipt] = msg
        key = (msg["fact"], msg["sender"], msg["receiver"])
        old = directed.get(key)
        if old is None:
            directed[key] = (msg["value"], [receipt])
        elif old[0] != msg["value"]:
            raise InputError(f"ambiguous directed value for {key}")
        else:
            old[1].append(receipt)
    messages = [receipts[key] for key in sorted(receipts)]
    return snapshot, facts, sorted(agents), edges, messages


def _differences(snapshot: str, fact: str, edges: list[tuple[str, str]],
                 messages: list[dict]) -> tuple[list[dict], list[list[str]]]:
    directions: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for msg in messages:
        if msg["fact"] == fact:
            directions[(msg["sender"], msg["receiver"])].append(msg)
    differences: list[dict] = []
    missing: list[list[str]] = []
    for u, v in edges:
        forward, reverse = directions.get((u, v)), directions.get((v, u))
        if not forward or not reverse:
            missing.append([u, v])
            continue
        receipts = [min(msg["receipt"] for msg in forward), min(msg["receipt"] for msg in reverse)]
        tail, head = forward[0]["value"], reverse[0]["value"]
        row = {"fact": fact, "snapshot": snapshot, "edge": [u, v], "receipts": receipts}
        if tail == head:
            row["kind"] = "zero"
        else:
            row.update({"kind": "signed", "tail": tail, "head": head})
        differences.append(row)
    return differences, missing


def _path(start: str, finish: str, adjacency: dict[str, list[tuple[str, dict]]]) -> list[dict]:
    if start == finish:
        return []
    queue = deque([start])
    parent: dict[str, tuple[str, dict] | None] = {start: None}
    while queue and finish not in parent:
        here = queue.popleft()
        for other, edge in adjacency[here]:
            if other not in parent:
                parent[other] = (here, edge)
                queue.append(other)
    if finish not in parent:
        raise AssertionError("union-find component lacks a zero path")
    route: list[dict] = []
    here = finish
    while here != start:
        previous, edge = parent[here]  # type: ignore[misc]
        route.append({"edge": edge["edge"], "receipts": edge["receipts"]})
        here = previous
    route.reverse()
    return route


def _categorical(snapshot: str, fact: str, values: list[str], agents: list[str],
                 differences: list[dict]) -> dict:
    parent = {agent: agent for agent in agents}
    size = {agent: 1 for agent in agents}

    def root(agent: str) -> str:
        while parent[agent] != agent:
            parent[agent] = parent[parent[agent]]
            agent = parent[agent]
        return agent

    zero_adj: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for row in differences:
        if row["kind"] == "zero":
            u, v = row["edge"]
            ru, rv = root(u), root(v)
            if ru != rv:
                if size[ru] < size[rv]:
                    ru, rv = rv, ru
                parent[rv] = ru
                size[ru] += size[rv]
            zero_adj[u].append((v, row))
            zero_adj[v].append((u, row))
    for neighbors in zero_adj.values():
        neighbors.sort(key=lambda item: (item[0], item[1]["receipts"]))
    pins: dict[str, dict] = {}
    for row in differences:
        if row["kind"] != "signed":
            continue
        u, v = row["edge"]
        for endpoint, value in ((u, row["tail"]), (v, row["head"])):
            pin = {"edge": row["edge"], "endpoint": endpoint,
                   "value": value, "receipts": row["receipts"]}
            component = root(endpoint)
            old = pins.get(component)
            if old is not None and old["value"] != value:
                certificate = {"fact": fact, "snapshot": snapshot,
                               "pins": [old, pin],
                               "zero_path": _path(old["endpoint"], endpoint, zero_adj)}
                assert verify_certificate(differences, certificate)
                return {"feasible": False, "certificate": certificate}
            pins[component] = old or pin
    assignment = {agent: pins.get(root(agent), {"value": values[0]})["value"] for agent in agents}
    return {"feasible": True, "assignment": assignment}


def verify_certificate(differences: list[dict], certificate: dict) -> bool:
    """Check a supplied contradiction using only admitted signed differences.

    This is deliberately a witness checker: it never calls the feasibility
    solver, reads raw messages, or infers an erased common value on zero edges.
    """
    if type(certificate) is not dict or set(certificate) != {"fact", "snapshot", "pins", "zero_path"}:
        return False
    fact, snapshot = certificate["fact"], certificate["snapshot"]
    if type(fact) is not str or not fact or type(snapshot) is not str or not snapshot:
        return False
    if type(differences) is not list or type(certificate["pins"]) is not list or len(certificate["pins"]) != 2:
        return False
    if type(certificate["zero_path"]) is not list:
        return False
    admitted: dict[tuple[str, str], dict] = {}
    used_receipts: set[str] = set()
    for row in differences:
        if type(row) is not dict or row.get("fact") != fact or row.get("snapshot") != snapshot:
            return False
        edge, receipts, kind = row.get("edge"), row.get("receipts"), row.get("kind")
        if (type(edge) is not list or len(edge) != 2 or any(type(x) is not str or not x for x in edge)
                or edge[0] >= edge[1] or type(receipts) is not list or len(receipts) != 2
                or any(type(x) is not str or not x for x in receipts) or receipts[0] == receipts[1]):
            return False
        if kind == "zero":
            if set(row) != {"fact", "snapshot", "edge", "receipts", "kind"}:
                return False
        elif kind == "signed":
            if (set(row) != {"fact", "snapshot", "edge", "receipts", "kind", "tail", "head"}
                    or type(row["tail"]) is not str or type(row["head"]) is not str
                    or not row["tail"] or not row["head"] or row["tail"] == row["head"]):
                return False
        else:
            return False
        key = tuple(edge)
        if key in admitted or any(receipt in used_receipts for receipt in receipts):
            return False
        admitted[key] = row
        used_receipts.update(receipts)
    endpoints = []
    values = []
    for pin in certificate["pins"]:
        if type(pin) is not dict or set(pin) != {"edge", "endpoint", "value", "receipts"}:
            return False
        edge = pin["edge"]
        if type(edge) is not list or len(edge) != 2 or any(type(x) is not str for x in edge):
            return False
        row = admitted.get(tuple(edge))
        if row is None or row["kind"] != "signed" or pin["receipts"] != row["receipts"]:
            return False
        endpoint, value = pin["endpoint"], pin["value"]
        if type(endpoint) is not str or type(value) is not str:
            return False
        if ((endpoint == edge[0] and value != row["tail"])
                or (endpoint == edge[1] and value != row["head"])
                or endpoint not in edge):
            return False
        endpoints.append(endpoint)
        values.append(value)
    if values[0] == values[1]:
        return False
    here = endpoints[0]
    for step in certificate["zero_path"]:
        if type(step) is not dict or set(step) != {"edge", "receipts"}:
            return False
        edge = step["edge"]
        if type(edge) is not list or len(edge) != 2 or any(type(x) is not str for x in edge):
            return False
        row = admitted.get(tuple(edge))
        if row is None or row["kind"] != "zero" or step["receipts"] != row["receipts"] or here not in edge:
            return False
        here = edge[1] if here == edge[0] else edge[0]
    return here == endpoints[1]


def _direct_sender(messages: list[dict], fact: str) -> list[dict]:
    grouped: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for msg in messages:
        if msg["fact"] == fact:
            grouped[msg["sender"]][msg["value"]].append(msg["receipt"])
    return [{"sender": sender,
             "values": [{"value": value, "receipts": sorted(ids)} for value, ids in sorted(by_value.items())]}
            for sender, by_value in sorted(grouped.items()) if len(by_value) > 1]


def _hodge(agents: list[str], differences: list[dict], values: list[str]) -> dict:
    """Optional dense diagnostics on the observed graph; never a decision gate."""
    n, m = len(agents), len(differences)
    observed = {row[label] for row in differences if row["kind"] == "signed" for label in ("tail", "head")}
    basis = [value for value in values if value in observed]
    unused = next((value for value in values if value not in observed), None)
    if unused is not None:
        basis.append(unused)
    if not basis:
        basis = [values[0]]
    d = len(basis)
    adjacency: dict[str, set[str]] = defaultdict(set)
    for row in differences:
        u, v = row["edge"]
        adjacency[u].add(v)
        adjacency[v].add(u)
    edge_index = {tuple(row["edge"]): i for i, row in enumerate(differences)}
    triangles = []
    for u in sorted(adjacency):
        for v in sorted(w for w in adjacency[u] if w > u):
            triangles.extend((u, v, w) for w in sorted(adjacency[u] & adjacency[v]) if w > v)
            if len(triangles) > 256:
                return {"status": "unavailable", "reason": "dense triangle budget exceeded"}
    # Budget before any dense B, triangle incidence, or projector allocation.
    t = len(triangles)
    dense_cells = m * n + m * d + t * m + 2 * m * m + t * t
    if n > 64 or m > 128 or d > 64 or dense_cells > 100000:
        return {"status": "unavailable", "reason": "dense dimension budget exceeded"}
    try:
        import numpy as np
    except ImportError:
        return {"status": "unavailable", "reason": "numpy unavailable"}
    index = {agent: i for i, agent in enumerate(agents)}
    value_index = {value: i for i, value in enumerate(basis)}
    b = np.zeros((m, n), dtype=float)
    g = np.zeros((m, d), dtype=float)
    for i, row in enumerate(differences):
        u, v = row["edge"]
        b[i, index[u]], b[i, index[v]] = -1.0, 1.0
        if row["kind"] == "signed":
            g[i, value_index[row["tail"]]] = -1.0
            g[i, value_index[row["head"]]] = 1.0
    # Both projectors are at most 128x128 under the budget above. Their
    # diagonals are topological leverage, not a classification of any agent.
    gradient_projector = b @ np.linalg.pinv(b) if m else np.zeros((0, 0))
    residual = g - gradient_projector @ g
    c = np.zeros((len(triangles), m), dtype=float)
    for i, (u, v, w) in enumerate(triangles):
        c[i, edge_index[(u, v)]] = 1.0
        c[i, edge_index[(v, w)]] = 1.0
        c[i, edge_index[(u, w)]] = -1.0
    curl_projector = c.T @ np.linalg.pinv(c @ c.T) @ c if len(triangles) else np.zeros((m, m))
    curl = curl_projector @ residual
    harmonic = residual - curl
    r2 = float(np.sum(residual * residual))
    h2 = float(np.sum(harmonic * harmonic))
    curl2 = float(np.sum(curl * curl))
    # Admitted categorical rows are integral, so these sub-1e-10 norms are
    # floating-point dust from dense projection rather than small input data.
    if r2 <= 1e-20:
        r2 = h2 = curl2 = 0.0
    else:
        if h2 <= 1e-20:
            h2 = 0.0
        if curl2 <= 1e-20:
            curl2 = 0.0
    tol = 1e-8

    def _unit(value: float) -> float:
        if not math.isfinite(value) or value < -tol or value > 1.0 + tol:
            raise ArithmeticError("projector leverage outside [0, 1]")
        return min(1.0, max(0.0, value))

    def _bridge(edge: tuple[str, str]) -> bool:
        start, finish = edge
        seen = {start}
        queue = deque([start])
        while queue:
            here = queue.popleft()
            for other in adjacency[here]:
                if tuple(sorted((here, other))) != edge and other not in seen:
                    if other == finish:
                        return False
                    seen.add(other)
                    queue.append(other)
        return True

    try:
        edge_diagnostics = []
        for i, row in enumerate(differences):
            edge = tuple(row["edge"])
            bridge = _bridge(edge)
            resistance = _unit(float(gradient_projector[i, i]))
            curl_leverage = _unit(float(curl_projector[i, i]))
            cycle_leverage = _unit(1.0 - resistance)
            harmonic_leverage = _unit(cycle_leverage - curl_leverage)
            if bridge and cycle_leverage > tol:
                raise ArithmeticError("bridge has nonzero cycle leverage")
            if bridge:
                resistance, cycle_leverage, harmonic_leverage, curl_leverage = 1.0, 0.0, 0.0, 0.0
            edge_diagnostics.append({
                "edge": row["edge"], "bridge": bridge,
                "effective_resistance": resistance,
                "cycle_sensitivity": math.sqrt(cycle_leverage),
                "curl_leverage": curl_leverage,
                "harmonic_leverage": harmonic_leverage,
                "legibility_ratio": harmonic_leverage / cycle_leverage if cycle_leverage > tol else None,
            })
    except ArithmeticError as exc:
        return {"status": "unavailable", "reason": str(exc)}
    triangle_values = c @ g
    witnesses = [list(triangle) for triangle, vector in zip(triangles, triangle_values)
                 if float(np.linalg.norm(vector)) > tol]
    return {"status": "ok", "residual_norm": math.sqrt(max(0.0, r2)),
            "curl_norm": math.sqrt(max(0.0, curl2)), "harmonic_norm": math.sqrt(max(0.0, h2)),
            "legibility_ratio": h2 / r2 if r2 > 1e-20 else None,
            "triangles": [list(triangle) for triangle in triangles],
            "witness_triangles": witnesses, "basis": basis,
            "edges": edge_diagnostics,
            "interpretation": "Cycle sensitivity is residual norm per unit-norm single-edge linear perturbation of admitted differences; these diagnostics do not identify truth or a culprit."}


def audit_document(data: dict, *, hodge: bool = False) -> dict:
    """Validate an input document and return deterministic, fact-specific evidence."""
    if type(hodge) is not bool:
        raise InputError("hodge must be boolean")
    snapshot, facts, agents, edges, messages = _parse(data)
    results = {}
    for fact in sorted(facts):
        differences, missing = _differences(snapshot, fact, edges, messages)
        result = {
            "coverage": {"observed_edges": [row["edge"] for row in differences],
                         "missing_edges": missing},
            "differences": differences,
            "categorical": _categorical(snapshot, fact, facts[fact], agents, differences),
            "direct_sender_inconsistencies": _direct_sender(messages, fact),
        }
        if hodge:
            result["hodge"] = _hodge(agents, differences, facts[fact])
        results[fact] = result
    return {"snapshot": snapshot, "facts": results}


def _unique_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise InputError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="offline JSON observation document")
    parser.add_argument("--hodge", action="store_true", help="add bounded NumPy diagnostics")
    args = parser.parse_args(argv)
    try:
        with open(args.input, "rb") as stream:
            raw = stream.read(MAX_JSON_BYTES + 1)
        if len(raw) > MAX_JSON_BYTES:
            raise InputError(f"JSON input exceeds {MAX_JSON_BYTES} bytes")
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object)
        result = audit_document(document, hodge=args.hodge)
    except (OSError, ValueError) as exc:
        print(f"claim audit input error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
