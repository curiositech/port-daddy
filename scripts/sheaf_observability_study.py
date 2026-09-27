#!/usr/bin/env python3
"""Offline, synthetic study of one versioned integer observation feature.

This is an algebra/observability fixture, not an agent run or a safety proof.
The supplied ledger is an independent synthetic truth anchor. No signature or
provenance verification is performed here.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, replace
from fractions import Fraction
from itertools import combinations, product
from typing import Iterable


FEATURE = "accepted-workintent-completion-count/v1"
WORK_ITEM = "synthetic-work-item-17"
SCHEMA_VERSION = 1
WATERMARK = 1042
SOURCE_ROOT = "synthetic-ledger-root-1042"
TRUTH = (2, 5, 1, 4)
SQUARE_DIAGONAL = ((0, 1), (1, 2), (2, 3), (0, 3), (0, 2))
SQUARE_DIAGONAL_PLUS_EDGE = SQUARE_DIAGONAL + ((1, 3),)
TRIANGLE_TAIL = ((0, 1), (1, 2), (0, 2), (2, 3))


def _reachable_vertices(
    edges: tuple[tuple[int, int], ...], vertices: int, removed: frozenset[int]
) -> set[int]:
    """Vertices reachable from zero after removing indexed edge packets."""
    adjacency: list[list[int]] = [[] for _ in range(vertices)]
    for index, (u, v) in enumerate(edges):
        if index not in removed:
            adjacency[u].append(v)
            adjacency[v].append(u)
    seen = {0}
    pending = [0]
    while pending:
        for neighbor in adjacency[pending.pop()]:
            if neighbor not in seen:
                seen.add(neighbor)
                pending.append(neighbor)
    return seen


def edge_connectivity(edges: tuple[tuple[int, int], ...], vertices: int = 4) -> int:
    """Exact edge cut size for a small connected loopless (multi)graph."""
    if vertices < 2 or _reachable_vertices(edges, vertices, frozenset()) != set(range(vertices)):
        raise ValueError("expected a connected graph with at least two vertices")
    if any(u == v for u, v in edges):
        raise ValueError("self-loops are outside the edge-report model")
    return min(
        sum((u in side) != (v in side) for u, v in edges)
        for mask in range(1 << (vertices - 1))
        for side in ({0} | {vertex for vertex in range(1, vertices) if mask & (1 << (vertex - 1))},)
        if len(side) < vertices
    )


def sparse_kernel_witness(
    edges: tuple[tuple[int, int], ...], sparsity: int, vertices: int = 4
) -> tuple[Fraction, ...] | None:
    """Find a nonzero rational gradient on at most ``sparsity`` edges.

    This finite deletion search is for small synthetic graphs. A disconnected
    remainder supplies a binary vertex potential and therefore an exact vector
    in ker(Q); it says nothing about semantic causes of the edge reports.
    """
    if sparsity < 0:
        raise ValueError("sparsity must be nonnegative")
    if vertices < 2 or _reachable_vertices(edges, vertices, frozenset()) != set(range(vertices)):
        raise ValueError("expected a connected graph with at least two vertices")
    if any(u == v for u, v in edges):
        raise ValueError("self-loops are outside the edge-report model")
    for size in range(1, min(sparsity, len(edges)) + 1):
        for removed in combinations(range(len(edges)), size):
            side = _reachable_vertices(edges, vertices, frozenset(removed))
            if len(side) < vertices:
                return tuple(Fraction(int(v in side) - int(u in side)) for u, v in edges)
    return None


@dataclass(frozen=True)
class Claim:
    edge: tuple[int, int]
    u_value: int | None
    v_value: int | None
    feature: str | None = FEATURE
    work_item: str | None = WORK_ITEM
    schema_version: int | None = SCHEMA_VERSION
    watermark: int | None = WATERMARK
    source_root: str | None = SOURCE_ROOT
    packet_id: str | None = None
    evidence_ref: str | None = None


def clean_claims(edges: Iterable[tuple[int, int]], truth: tuple[int, ...] = TRUTH) -> tuple[Claim, ...]:
    return tuple(
        Claim((u, v), truth[u], truth[v], packet_id=f"synthetic-packet-{index}",
              evidence_ref=f"synthetic-evidence-{index}")
        for index, (u, v) in enumerate(edges)
    )


def admit(claims: tuple[Claim, ...], edges: tuple[tuple[int, int], ...]) -> tuple[bool, str]:
    if len(claims) != len(edges) or tuple(c.edge for c in claims) != edges:
        return False, "missing-or-reordered-edge"
    packet_ids: set[str] = set()
    evidence_refs: set[str] = set()
    for claim in claims:
        if (claim.feature, claim.work_item, claim.schema_version, claim.watermark, claim.source_root) != (
            FEATURE, WORK_ITEM, SCHEMA_VERSION, WATERMARK, SOURCE_ROOT
        ):
            return False, "missing-or-mismatched-metadata"
        if not isinstance(claim.packet_id, str) or not claim.packet_id.strip():
            return False, "missing-packet-id"
        if claim.packet_id in packet_ids:
            return False, "duplicate-packet-id"
        packet_ids.add(claim.packet_id)
        if not isinstance(claim.evidence_ref, str) or not claim.evidence_ref.strip():
            return False, "missing-evidence-ref"
        if claim.evidence_ref in evidence_refs:
            return False, "duplicate-evidence-ref"
        evidence_refs.add(claim.evidence_ref)
        if type(claim.u_value) is not int or type(claim.v_value) is not int:
            return False, "missing-or-noninteger-claim"
    return True, "admitted"


def observations(claims: tuple[Claim, ...]) -> tuple[int, ...]:
    return tuple(c.v_value - c.u_value for c in claims)  # type: ignore[operator]


def consistency_oracle(edges: tuple[tuple[int, int], ...], y: tuple[int, ...], vertices: int = 4) -> bool:
    """Independent exact constraint oracle: propagate integer potentials on each component."""
    adjacency: list[list[tuple[int, int]]] = [[] for _ in range(vertices)]
    for (u, v), difference in zip(edges, y, strict=True):
        adjacency[u].append((v, difference))
        adjacency[v].append((u, -difference))
    potentials: list[int | None] = [None] * vertices
    for root in range(vertices):
        if potentials[root] is not None:
            continue
        potentials[root] = 0
        pending = [root]
        while pending:
            u = pending.pop()
            for v, difference in adjacency[u]:
                proposed = potentials[u] + difference  # type: ignore[operator]
                if potentials[v] is None:
                    potentials[v] = proposed
                    pending.append(v)
                elif potentials[v] != proposed:
                    return False
    return True


def duplicate_claim_baseline(claims: tuple[Claim, ...]) -> bool:
    """True means the cheap per-vertex duplicate-value check raises an alarm."""
    seen: dict[int, int] = {}
    for claim in claims:
        for vertex, value in ((claim.edge[0], claim.u_value), (claim.edge[1], claim.v_value)):
            if vertex in seen and seen[vertex] != value:
                return True
            seen[vertex] = value  # type: ignore[assignment]
    return False


def ledger_oracle(claims: tuple[Claim, ...], truth: tuple[int, ...] = TRUTH) -> bool:
    """True means a claim conflicts with the independent synthetic event ledger."""
    return any(c.u_value != truth[c.edge[0]] or c.v_value != truth[c.edge[1]] for c in claims)


def _solve_exact(matrix: list[list[Fraction]], rhs: list[Fraction]) -> list[Fraction]:
    augmented = [row[:] + [value] for row, value in zip(matrix, rhs, strict=True)]
    for column in range(len(rhs)):
        pivot = next(row for row in range(column, len(rhs)) if augmented[row][column] != 0)
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        scale = augmented[column][column]
        augmented[column] = [item / scale for item in augmented[column]]
        for row in range(len(rhs)):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [a - factor * b for a, b in zip(augmented[row], augmented[column], strict=True)]
    return [row[-1] for row in augmented]


def projection_signature(edges: tuple[tuple[int, int], ...], y: tuple[int | Fraction, ...], vertices: int = 4) -> tuple[Fraction, ...]:
    """Exact rational projection onto the graph cycle space.

    This is a separate diagnostic from consistency_oracle, built using a
    fundamental-cycle basis and rational Gram solve. It is not a truth score.
    """
    parent = list(range(vertices))
    forest: list[list[tuple[int, int, int]]] = [[] for _ in range(vertices)]
    chords: list[int] = []

    def root(vertex: int) -> int:
        while parent[vertex] != vertex:
            vertex = parent[vertex]
        return vertex

    for index, (u, v) in enumerate(edges):
        ru, rv = root(u), root(v)
        if ru == rv:
            chords.append(index)
        else:
            parent[ru] = rv
            forest[u].append((v, index, 1))
            forest[v].append((u, index, -1))

    cycles: list[list[Fraction]] = []
    for chord in chords:
        u, v = edges[chord]
        pending = [(v, [(chord, 1)])]
        visited = {v}
        while pending:
            node, path = pending.pop()
            if node == u:
                cycle = [Fraction(0)] * len(edges)
                for index, sign in path:
                    cycle[index] = Fraction(sign)
                cycles.append(cycle)
                break
            for neighbor, index, sign in forest[node]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    pending.append((neighbor, path + [(index, sign)]))
    if not cycles:
        return (Fraction(0),) * len(edges)
    gram = [[sum(a * b for a, b in zip(left, right, strict=True)) for right in cycles] for left in cycles]
    rhs = [sum(value * observation for value, observation in zip(cycle, y, strict=True)) for cycle in cycles]
    coefficients = _solve_exact(gram, rhs)
    return tuple(sum(coefficient * cycle[index] for coefficient, cycle in zip(coefficients, cycles, strict=True))
                 for index in range(len(edges)))


def projection_energy(edges: tuple[tuple[int, int], ...], y: tuple[int | Fraction, ...], vertices: int = 4) -> Fraction:
    signature = projection_signature(edges, y, vertices)
    return sum(value * value for value in signature)


def signature_library(edges: tuple[tuple[int, int], ...], mutated_edges: int = 5) -> dict[str, tuple[Fraction, ...]]:
    """Predeclared report mutations: no failure and ±1 on each original edge."""
    if mutated_edges > len(edges):
        raise ValueError("mutation library has more edges than the graph")
    library = {"none": projection_signature(edges, (0,) * len(edges))}
    for index in range(mutated_edges):
        for sign in (-1, 1):
            mutation = tuple(sign if position == index else 0 for position in range(len(edges)))
            library[f"edge-{index}:{sign:+d}"] = projection_signature(edges, mutation)
    return library


def squared_distance(left: tuple[Fraction, ...], right: tuple[Fraction, ...]) -> Fraction:
    return sum((a - b) ** 2 for a, b in zip(left, right, strict=True))


def signature_identifiability(edges: tuple[tuple[int, int], ...], mutated_edges: int = 5) -> dict[str, object]:
    library = signature_library(edges, mutated_edges)
    classes: dict[tuple[Fraction, ...], list[str]] = {}
    for label, signature in library.items():
        classes.setdefault(signature, []).append(label)
    label_distances = [squared_distance(a, b) for a, b in combinations(library.values(), 2)]
    class_distances = [squared_distance(a, b) for a, b in combinations(classes, 2)]
    label_min = min(label_distances) if label_distances else None
    class_min = min(class_distances) if class_distances else None
    return {
        "edges": [list(edge) for edge in edges],
        "mutation_library": "no failure plus signed one-unit target-side report mutation on each original edge",
        "mutated_original_edges": mutated_edges,
        "label_count": len(library),
        "distinct_signature_count": len(classes),
        "indistinguishable_classes": [labels for labels in classes.values() if len(labels) > 1],
        "minimum_label_separation_squared": str(label_min) if label_min is not None else None,
        "minimum_distinct_class_separation_squared": str(class_min) if class_min is not None else None,
        "robust_nearest_class_radius_squared": str(class_min / 4) if class_min is not None else None,
        "robust_nearest_class_radius": f"sqrt({class_min})/2" if class_min is not None else None,
        "radius_condition": "If squared projected noise norm is strictly below radius squared, nearest distinct signature class is unique; labels within a class remain indistinguishable.",
    }


def active_audit_probe_design() -> dict[str, object]:
    """Choose one independent extra observation for the unchanged old fault library."""
    candidates = [("new-cross-edge-1-3", (1, 3))] + [
        (f"independent-repeat-edge-{index}", edge)
        for index, edge in enumerate(SQUARE_DIAGONAL)
    ]
    scored = []
    for name, edge in candidates:
        result = signature_identifiability(SQUARE_DIAGONAL + (edge,), len(SQUARE_DIAGONAL))
        scored.append({"probe": name, "edge": list(edge),
                       "minimum_label_separation_squared": result["minimum_label_separation_squared"],
                       "distinct_signature_count": result["distinct_signature_count"]})
    best_margin = max(Fraction(row["minimum_label_separation_squared"]) for row in scored)
    return {
        "candidate_assumption": "Each candidate costs one extra packet and supplies an independent, same-watermark, same-feature observation with zero fault on the new packet; the old 11 labels are unchanged.",
        "candidates": scored,
        "maximin_margin_squared": str(best_margin),
        "all_maximizers": [row["probe"] for row in scored if Fraction(row["minimum_label_separation_squared"]) == best_margin],
        "meaning": "Measurement design for this finite report-mutation library only; no repair, culprit attribution, or semantic-failure guarantee.",
    }


def classify_report_mutation(
    edges: tuple[tuple[int, int], ...],
    observed: tuple[int | Fraction, ...],
    projected_noise_bound_squared: Fraction,
    mutated_edges: int = 5,
) -> dict[str, object]:
    """Classify only the finite report-mutation codebook under a declared bound.

    A candidate class is feasible when its exact squared distance to Q(observed)
    is at most the bound. A unique class with multiple labels is still ambiguous.
    This says nothing about semantic failure causes or evidence authenticity.
    """
    if projected_noise_bound_squared < 0:
        raise ValueError("noise bound squared must be nonnegative")
    observed_signature = projection_signature(edges, observed)
    classes: dict[tuple[Fraction, ...], list[str]] = {}
    for label, signature in signature_library(edges, mutated_edges).items():
        classes.setdefault(signature, []).append(label)
    ranked = sorted(
        ((squared_distance(observed_signature, signature), labels) for signature, labels in classes.items()),
        key=lambda item: (item[0], item[1]),
    )
    candidates = [{"labels": labels, "distance_squared": str(distance)}
                  for distance, labels in ranked if distance <= projected_noise_bound_squared]
    if len(candidates) == 1 and len(candidates[0]["labels"]) == 1:
        status = "identified_report_mutation"
        label = candidates[0]["labels"][0]
    elif candidates:
        status = "ambiguous"
        label = None
    else:
        status = "out_of_library"
        label = None
    margin = signature_identifiability(edges, mutated_edges)
    return {
        "status": status,
        "label": label,
        "candidate_classes": candidates,
        "nearest_class_distance_squared": str(ranked[0][0]),
        "second_nearest_class_distance_squared": str(ranked[1][0]) if len(ranked) > 1 else None,
        "minimum_distinct_class_separation_squared": margin["minimum_distinct_class_separation_squared"],
        "declared_projected_noise_bound_squared": str(projected_noise_bound_squared),
        "rule": "Identify a report-mutation label only if exactly one label in one class lies within the declared projected-noise ball; otherwise report ambiguity or out-of-library.",
    }


def perturb_edges(claims: tuple[Claim, ...], perturbation: tuple[int, ...]) -> tuple[Claim, ...]:
    """Change only the target-side claim in each edge-specific packet."""
    return tuple(replace(claim, v_value=claim.v_value + delta) for claim, delta in zip(claims, perturbation, strict=True))  # type: ignore[operator]


def inspect(claims: tuple[Claim, ...], edges: tuple[tuple[int, int], ...], truth: tuple[int, ...] = TRUTH) -> dict[str, object]:
    accepted, reason = admit(claims, edges)
    if not accepted:
        return {"status": "abstain", "reason": reason}
    y = observations(claims)
    energy = projection_energy(edges, y, len(truth))
    return {
        "status": "analyzed",
        "compatible": consistency_oracle(edges, y, len(truth)),
        "projection_energy": str(energy),
        "duplicate_claim_alarm": duplicate_claim_baseline(claims),
        "ledger_disagreement": ledger_oracle(claims, truth),
    }


def sparse_edge_error_study() -> dict[str, object]:
    """Small exact falsification search for the bounded edge-error cut rule."""
    all_edges = tuple(combinations(range(4), 2))
    counts = {"connected_graphs": 0, "k_1_identifiable": 0, "k_2_identifiable": 0,
              "cut_witness_disagreements": 0}
    for mask in range(1 << len(all_edges)):
        edges = tuple(edge for index, edge in enumerate(all_edges) if mask & (1 << index))
        if _reachable_vertices(edges, 4, frozenset()) != set(range(4)):
            continue
        counts["connected_graphs"] += 1
        cut_size = edge_connectivity(edges)
        for k in (1, 2):
            identifiable = cut_size > 2 * k
            counts[f"k_{k}_identifiable"] += identifiable
            witness = sparse_kernel_witness(edges, 2 * k)
            counts["cut_witness_disagreements"] += (witness is None) != identifiable

    edges = SQUARE_DIAGONAL_PLUS_EDGE  # K4: minimum cut has three edge packets.
    gradient = sparse_kernel_witness(edges, 4)
    assert gradient is not None and sum(value != 0 for value in gradient) == 3
    support = [index for index, value in enumerate(gradient) if value]
    a = tuple(gradient[index] if index in support[:2] else Fraction(0) for index in range(len(edges)))
    b = tuple(-gradient[index] if index in support[2:] else Fraction(0) for index in range(len(edges)))
    assert tuple(left - right for left, right in zip(a, b, strict=True)) == gradient
    assert projection_signature(edges, a) == projection_signature(edges, b)
    return {
        "model": "real, edge-specific report errors with at most k nonzero edge coordinates; exact graph and projection",
        "criterion": "All such errors are identifiable from Q a exactly when edge connectivity exceeds 2k.",
        "four_vertex_simple_graph_search": counts,
        "k4_two_sparse_collision": {
            "edges": [list(edge) for edge in edges],
            "edge_connectivity": edge_connectivity(edges),
            "a": [str(value) for value in a],
            "b": [str(value) for value in b],
            "common_projection": [str(value) for value in projection_signature(edges, a)],
        },
        "limit": "This identifies bounded edge-report error vectors, not semantic collusion, false consistent vertex claims, or evidence authenticity.",
    }


def run_study() -> dict[str, object]:
    edges = SQUARE_DIAGONAL
    clean = clean_claims(edges)
    cases: dict[str, dict[str, object]] = {
        "clean_unequal_counts": inspect(clean, edges),
        "single_cycle_edge": inspect(perturb_edges(clean, (1, 0, 0, 0, 0)), edges),
    }
    bridge_clean = clean_claims(TRIANGLE_TAIL)
    cases["bridge_fault"] = inspect(perturb_edges(bridge_clean, (0, 0, 0, 1)), TRIANGLE_TAIL)
    # One vertex makes the same false claim on every incident edge: a pure gradient.
    vertex_shift = tuple(
        replace(c, u_value=c.u_value + (1 if c.edge[0] == 0 else 0),
                v_value=c.v_value + (1 if c.edge[1] == 0 else 0)) for c in clean
    )
    cases["gradient_collusion"] = inspect(vertex_shift, edges)
    cases["consistent_but_wrong"] = inspect(
        tuple(replace(c, u_value=c.u_value + 1, v_value=c.v_value + 1) for c in clean), edges
    )
    cases["stale_watermark"] = inspect((replace(clean[0], watermark=WATERMARK - 1),) + clean[1:], edges)
    cases["stale_schema"] = inspect((replace(clean[0], schema_version=SCHEMA_VERSION - 1),) + clean[1:], edges)
    cases["stale_work_item"] = inspect((replace(clean[0], work_item="other-work-item"),) + clean[1:], edges)
    cases["missing_metadata"] = inspect((replace(clean[0], source_root=None),) + clean[1:], edges)
    cases["duplicate_packet"] = inspect((clean[0], replace(clean[1], packet_id=clean[0].packet_id)) + clean[2:], edges)
    cases["missing_evidence"] = inspect((replace(clean[0], evidence_ref=None),) + clean[1:], edges)
    cases["duplicate_evidence"] = inspect((clean[0], replace(clean[1], evidence_ref=clean[0].evidence_ref)) + clean[2:], edges)
    cases["missing_edge"] = inspect(clean[:-1], edges)

    counts = {"perturbations": 0, "compatible": 0, "incompatible": 0,
              "projection_oracle_disagreements": 0, "duplicate_alarm": 0,
              "ledger_disagreement": 0, "ledger_disagreement_with_zero_projection": 0,
              "projection_ledger_true_positive": 0, "projection_ledger_false_positive": 0,
              "duplicate_ledger_true_positive": 0, "duplicate_ledger_false_positive": 0}
    for perturbation in product((-1, 0, 1), repeat=len(edges)):
        claims = perturb_edges(clean, perturbation)
        result = inspect(claims, edges)
        counts["perturbations"] += 1
        compatible = bool(result["compatible"])
        counts["compatible" if compatible else "incompatible"] += 1
        counts["projection_oracle_disagreements"] += (result["projection_energy"] == "0") != compatible
        counts["duplicate_alarm"] += bool(result["duplicate_claim_alarm"])
        counts["ledger_disagreement"] += bool(result["ledger_disagreement"])
        counts["ledger_disagreement_with_zero_projection"] += bool(result["ledger_disagreement"] and result["projection_energy"] == "0")
        for method, alarm in (("projection", not compatible), ("duplicate", bool(result["duplicate_claim_alarm"]))):
            if alarm:
                key = f"{method}_ledger_{'true' if result['ledger_disagreement'] else 'false'}_positive"
                counts[key] += 1
    original_library = signature_library(SQUARE_DIAGONAL, len(SQUARE_DIAGONAL))
    extended_library = signature_library(SQUARE_DIAGONAL_PLUS_EDGE, len(SQUARE_DIAGONAL))
    pairwise_changes = {"pairs": 0, "smaller_after_added_edge": 0,
                        "strictly_larger_after_added_edge": 0, "degenerate_pairs_resolved": 0}
    for left, right in combinations(original_library, 2):
        before = squared_distance(original_library[left], original_library[right])
        after = squared_distance(extended_library[left], extended_library[right])
        pairwise_changes["pairs"] += 1
        pairwise_changes["smaller_after_added_edge"] += after < before
        pairwise_changes["strictly_larger_after_added_edge"] += after > before
        pairwise_changes["degenerate_pairs_resolved"] += before == 0 and after > 0
    return {
        "scope": "offline deterministic synthetic fixtures; one integer feature at one watermark; no signatures or real agents verified",
        "feature": FEATURE,
        "work_item": WORK_ITEM,
        "schema_version": SCHEMA_VERSION,
        "watermark": WATERMARK,
        "source_root": SOURCE_ROOT,
        "graph_edges": [list(edge) for edge in edges],
        "truth": list(TRUTH),
        "cases": cases,
        "exhaustive": counts,
        "identifiability": {
            "original_five_edge_graph": signature_identifiability(SQUARE_DIAGONAL, len(SQUARE_DIAGONAL)),
            "same_labels_with_added_edge": signature_identifiability(SQUARE_DIAGONAL_PLUS_EDGE, len(SQUARE_DIAGONAL)),
            "fixed_label_pairwise_comparison": pairwise_changes,
            "limit": "Failure labels denote specified report mutations, not semantic causes or dishonest agents.",
            "classification_examples": {
                "original_edge_0_plus_one": classify_report_mutation(SQUARE_DIAGONAL, (1, 0, 0, 0, 0), Fraction(0)),
                "extended_edge_0_plus_one": classify_report_mutation(SQUARE_DIAGONAL_PLUS_EDGE, (1, 0, 0, 0, 0, 0), Fraction(1, 16)),
                "original_two_unit_out_of_library": classify_report_mutation(SQUARE_DIAGONAL, (2, 0, 0, 0, 0), Fraction(0)),
            },
        },
        "active_audit_probe": active_audit_probe_design(),
        "sparse_edge_error_identifiability": sparse_edge_error_study(),
        "interpretation": "Nonzero projection proves only that these same-feature edge differences have no global potential. Zero projection does not prove claims true, authorized, or safe. On this synthetic corpus, the cheaper duplicate-claim check detects more ledger disagreements, so no incremental utility claim is supported.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    args = parser.parse_args()
    study = run_study()
    if args.format == "json":
        print(json.dumps(study, indent=2, sort_keys=True))
        return
    print("# Offline sheaf observability study\n")
    print(study["scope"] + ".\n")
    print("| Case | Compatible | Projection energy | Duplicate check | Ledger disagreement |")
    print("| --- | --- | ---: | --- | --- |")
    for name, result in study["cases"].items():
        if result["status"] == "abstain":
            print(f"| {name} | abstain: {result['reason']} | — | — | — |")
        else:
            print(f"| {name} | {result['compatible']} | {result['projection_energy']} | {result['duplicate_claim_alarm']} | {result['ledger_disagreement']} |")
    print("\nExhaustive edge perturbations:", json.dumps(study["exhaustive"], sort_keys=True))
    identifiability = study["identifiability"]
    print("\n## Fixed-library report-mutation identifiability\n")
    print("| Graph | Labels | Distinct signatures | Minimum label distance² | Minimum distinct-class distance² | Robust radius² |")
    print("| --- | ---: | ---: | ---: | ---: | ---: |")
    for key, name in (("original_five_edge_graph", "Square plus diagonal"),
                      ("same_labels_with_added_edge", "Same labels, added edge (1,3)")):
        row = identifiability[key]
        print(f"| {name} | {row['label_count']} | {row['distinct_signature_count']} | {row['minimum_label_separation_squared']} | {row['minimum_distinct_class_separation_squared']} | {row['robust_nearest_class_radius_squared']} |")
        print(f"Indistinguishable on {name}: {row['indistinguishable_classes']}")
    print("Fixed-label pairwise changes:", json.dumps(identifiability["fixed_label_pairwise_comparison"], sort_keys=True))
    print(identifiability["limit"])
    print("Finite-codebook examples:")
    for name, example in identifiability["classification_examples"].items():
        print(f"- {name}: {example['status']}; label={example['label']}; nearest distance²={example['nearest_class_distance_squared']}; bound²={example['declared_projected_noise_bound_squared']}; candidates={example['candidate_classes']}")
    probe = study["active_audit_probe"]
    print("\n## One-packet active audit probe\n")
    print(probe["candidate_assumption"])
    for candidate in probe["candidates"]:
        print(f"- {candidate['probe']}: min label distance² = {candidate['minimum_label_separation_squared']}; distinct signatures = {candidate['distinct_signature_count']}")
    print(f"Maximin margin² = {probe['maximin_margin_squared']}; all maximizers: {probe['all_maximizers']}")
    print(probe["meaning"])
    sparse = study["sparse_edge_error_identifiability"]
    print("\n## Bounded edge-report error identifiability\n")
    print(sparse["model"])
    print(sparse["criterion"])
    print("Four-vertex exact search:", json.dumps(sparse["four_vertex_simple_graph_search"], sort_keys=True))
    print("K4 two-sparse collision:", json.dumps(sparse["k4_two_sparse_collision"], sort_keys=True))
    print(sparse["limit"])
    print("\n" + study["interpretation"])


if __name__ == "__main__":
    main()
