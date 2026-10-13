#!/usr/bin/env python3
"""Exact, synthetic, costed receipt acquisition for a fixed finite library.

Run with Python 3 and NumPy. Importing this module has no side effects.
No receipt is cryptographically verified here and no network or model is called.
"""

from dataclasses import dataclass
from itertools import combinations, permutations
import json

import numpy as np


@dataclass(frozen=True)
class Packet:
    name: str
    evidence_id: str
    source: str
    kind: str  # edge or raw: a direct, numeric claim-conflict feature
    values: tuple[float, ...]  # one frozen signature per hypothesis
    cost: int = 0
    edge: tuple[int, int] | None = None
    authorized: bool = True
    available: bool = True


@dataclass(frozen=True)
class Instance:
    name: str
    vertices: int
    labels: tuple[str, ...]
    base: tuple[Packet, ...]
    candidates: tuple[Packet, ...]
    epsilon: float


def edge(name, u, v, values, cost=0, **options):
    return Packet(name, options.pop("evidence_id", name),
                  options.pop("source", name), "edge", tuple(values), cost,
                  (u, v), **options)


def raw(name, values, cost=0, **options):
    return Packet(name, options.pop("evidence_id", name),
                  options.pop("source", name), "raw", tuple(values), cost,
                  None, **options)


def admitted(instance):
    existing = {p.evidence_id for p in instance.base}
    result = []
    for packet in instance.candidates:
        if not packet.authorized or not packet.available:
            continue
        if packet.evidence_id in existing:
            continue  # another copy is not another independent observation
        existing.add(packet.evidence_id)
        result.append(packet)
    return tuple(result)


def validate(instance):
    assert 1 <= instance.vertices <= 6
    assert 2 <= len(instance.labels)
    assert instance.epsilon >= 0
    names = [p.name for p in instance.base + instance.candidates]
    assert len(names) == len(set(names))
    identities = {}
    for packet in instance.base + instance.candidates:
        assert len(packet.values) == len(instance.labels)
        assert packet.cost >= 0
        assert packet.kind in ("edge", "raw")
        if packet.kind == "edge":
            assert packet.edge is not None
            u, v = packet.edge
            assert 0 <= u < instance.vertices and 0 <= v < instance.vertices and u != v
        else:
            assert packet.edge is None
        prior = identities.get(packet.evidence_id)
        if prior is not None:
            assert (packet.kind, packet.edge, packet.values, packet.source) == prior
        identities[packet.evidence_id] = (packet.kind, packet.edge,
                                           packet.values, packet.source)
    candidate_costs = {}
    for packet in instance.candidates:
        prior_cost = candidate_costs.setdefault(packet.evidence_id, packet.cost)
        assert prior_cost == packet.cost, "copies with different prices require one declared acquisition price"
    assert len({p.evidence_id for p in instance.base}) == len(instance.base)
    assert all(p.cost == 0 for p in instance.base)


def distances(instance, chosen=()):
    """Pairwise quotient distances with unrestricted nuisance potentials.

    Raw dimensions are direct claim checks with the same declared Euclidean
    coordinate scale; they are outside the incidence image. SVD supplies an
    independent orthonormal cycle-coordinate calculation for each pair.
    """
    packets = []
    seen = set()
    for packet in instance.base + tuple(chosen):
        if not packet.authorized or not packet.available:
            raise ValueError(f"inadmissible packet: {packet.name}")
        if packet.evidence_id not in seen:
            packets.append(packet)
            seen.add(packet.evidence_id)
    edge_packets = [p for p in packets if p.kind == "edge"]
    raw_packets = [p for p in packets if p.kind == "raw"]
    matrix = np.zeros((len(edge_packets), instance.vertices))
    for row, packet in enumerate(edge_packets):
        u, v = packet.edge
        matrix[row, u], matrix[row, v] = 1, -1
    _, singular, left_t = np.linalg.svd(matrix.T, full_matrices=True)
    rank = int(np.sum(singular > 1e-10))
    cycle_coordinates = left_t[rank:, :]
    result = {}
    for i, j in combinations(range(len(instance.labels)), 2):
        edge_delta = np.array([p.values[i] - p.values[j]
                               for p in edge_packets], dtype=float)
        raw_delta = np.array([p.values[i] - p.values[j]
                              for p in raw_packets], dtype=float)
        residual = edge_delta - matrix @ np.linalg.lstsq(
            matrix, edge_delta, rcond=None)[0]
        squared = float(residual @ residual + raw_delta @ raw_delta)
        cycle_squared = float(np.sum((cycle_coordinates @ edge_delta) ** 2)
                              + raw_delta @ raw_delta)
        assert np.isclose(squared, cycle_squared, atol=1e-10)
        # Decimal rounding is a declared numerical convention for these small
        # rational fixtures; sub-1e-12 least-squares dust cannot break ties.
        result[f"{instance.labels[i]}|{instance.labels[j]}"] = round(squared, 12)
    return result


def score(instance, chosen=()):
    d2 = distances(instance, chosen)
    threshold2 = (2 * instance.epsilon) ** 2
    return (sum(value > threshold2 + 1e-12 for value in d2.values()),
            min(d2.values()))


def cost(chosen):
    return sum(packet.cost for packet in chosen)


def bundle_names(chosen):
    return [packet.name for packet in chosen]


def enumerate_bundles(instance, budget):
    choices = admitted(instance)
    assert all(p.cost >= 1 for p in choices)
    for length in range(len(choices) + 1):
        for bundle in combinations(choices, length):
            if cost(bundle) <= budget:
                yield bundle


def oracle(instance, budget):
    bundles = list(enumerate_bundles(instance, budget))
    best_score = max(score(instance, b) for b in bundles)
    tied = [b for b in bundles if score(instance, b) == best_score]
    least_cost = min(cost(b) for b in tied)
    tied = [b for b in tied if cost(b) == least_cost]
    winner = min(tied, key=lambda b: tuple(bundle_names(b)))
    return winner, len(tied), len(bundles)


def cost_ranked(instance, budget):
    result = []
    for packet in sorted(admitted(instance), key=lambda p: (p.cost, p.name)):
        if cost(result) + packet.cost <= budget:
            result.append(packet)
    return tuple(result)


def one_step(instance, budget):
    result = []
    while True:
        current = score(instance, result)
        eligible = [p for p in admitted(instance)
                    if p not in result and cost(result) + p.cost <= budget]
        if not eligible:
            break
        def gain(packet):
            after = score(instance, result + [packet])
            return ((after[0] - current[0]) / packet.cost,
                    (after[1] - current[1]) / packet.cost)
        best_gain = max(gain(p) for p in eligible)
        if best_gain[0] <= 1e-12 and best_gain[1] <= 1e-12:
            break
        result.append(min((p for p in eligible if gain(p) == best_gain),
                          key=lambda p: p.name))
    return tuple(result)


def two_step(instance, budget):
    result = []
    while True:
        current = score(instance, result)
        remaining = [p for p in admitted(instance) if p not in result]
        plans = []
        for length in (1, 2):
            for plan in combinations(remaining, length):
                if cost(result) + cost(plan) <= budget:
                    plans.append(tuple(sorted(plan, key=lambda p: p.name)))
        if not plans:
            break
        best_score = max(score(instance, result + list(plan)) for plan in plans)
        if best_score == current:
            break
        best_plans = [plan for plan in plans
                      if score(instance, result + list(plan)) == best_score]
        plan = min(best_plans, key=lambda p: (cost(p), tuple(bundle_names(p))))
        result.append(plan[0])
    return tuple(result)


def random_exact(instance, budget):
    outcomes = []
    choices = admitted(instance)
    for order in permutations(choices):
        bundle = []
        for packet in order:
            if cost(bundle) + packet.cost <= budget:
                bundle.append(packet)
        outcomes.append((tuple(bundle), score(instance, bundle)))
    return {
        "orders": len(outcomes),
        "expected_separated_pairs": sum(s[0] for _, s in outcomes) / len(outcomes),
        "expected_min_distance_squared": sum(s[1] for _, s in outcomes) / len(outcomes),
        "separated_pairs_distribution": {
            str(k): sum(s[0] == k for _, s in outcomes)
            for k in sorted({s[0] for _, s in outcomes})},
    }


def cheapest_unbalanced_cycle(instance):
    """One initially degenerate pair, edge-only: enumerate contracted simple cycles.

    This is a finite certificate, not a polynomial-time claim. Base components
    are contracted; a candidate inside one component becomes a loop. A cycle
    is unbalanced when its gain vector is not a gradient on that cycle.
    """
    assert len(instance.labels) == 2
    assert all(p.kind == "edge" for p in instance.base + admitted(instance))
    assert next(iter(distances(instance).values())) == 0
    base = np.zeros((len(instance.base), instance.vertices))
    base_delta = np.array([p.values[0] - p.values[1] for p in instance.base])
    parent = list(range(instance.vertices))

    def root(v):
        while parent[v] != v:
            v = parent[v]
        return v

    for row, packet in enumerate(instance.base):
        u, v = packet.edge
        base[row, u], base[row, v] = 1, -1
        parent[root(v)] = root(u)
    x0 = np.linalg.lstsq(base, base_delta, rcond=None)[0]
    assert np.linalg.norm(base_delta - base @ x0) < 1e-10
    groups = {v: root(v) for v in range(instance.vertices)}
    choices = admitted(instance)
    cycles = []
    for length in range(1, len(choices) + 1):
        for bundle in combinations(choices, length):
            degree = {}
            adjacency = {}
            for packet in bundle:
                u, v = (groups[n] for n in packet.edge)
                degree[u] = degree.get(u, 0) + 1
                degree[v] = degree.get(v, 0) + 1
                adjacency.setdefault(u, set()).add(v)
                adjacency.setdefault(v, set()).add(u)
            if not all(value == 2 for value in degree.values()):
                continue
            reached = set()
            frontier = [next(iter(degree))]
            while frontier:
                v = frontier.pop()
                if v not in reached:
                    reached.add(v)
                    frontier.extend(adjacency[v] - reached)
            if len(reached) != len(degree):
                continue
            compact = {v: i for i, v in enumerate(sorted(degree))}
            matrix = np.zeros((len(bundle), len(compact)))
            gain = np.zeros(len(bundle))
            for row, packet in enumerate(bundle):
                u, v = packet.edge
                matrix[row, compact[groups[u]]] += 1
                matrix[row, compact[groups[v]]] -= 1
                gain[row] = packet.values[0] - packet.values[1] - (x0[u] - x0[v])
            imbalance = gain - matrix @ np.linalg.lstsq(matrix, gain, rcond=None)[0]
            if np.linalg.norm(imbalance) > 1e-10:
                cycles.append(bundle)
    assert cycles
    winner = min(cycles, key=lambda b: (cost(b), tuple(bundle_names(b))))
    all_separating = [b for b in enumerate_bundles(instance, sum(p.cost for p in choices))
                      if next(iter(distances(instance, b).values())) > 0]
    assert cost(winner) == min(map(cost, all_separating))
    return {"bundle": bundle_names(winner), "cost": cost(winner),
            "enumerated_unbalanced_simple_cycles": len(cycles)}


def fixtures():
    h = ("consistent", "declared_fault")
    bridge_base = (edge("base01", 0, 1, (0, 0)),)
    a = edge("a12", 1, 2, (0, 1), 1, source="source-a")
    b = edge("b20", 2, 0, (0, 0), 2, source="source-b")
    c = edge("c01", 0, 1, (0, 0.25), 1, source="source-c")
    return (
        Instance("triangle_zero_gain", 3, h, bridge_base, (a, b), 0.1),
        Instance("triangle_decoy", 3, h, bridge_base, (a, b, c), 0.1),
        Instance("location", 3, ("fault01", "fault12", "honest"),
                 (edge("base01", 0, 1, (1, 0, 0)),
                  edge("base12", 1, 2, (0, 1, 0)),
                  edge("base20", 2, 0, (0, 0, 0))),
                 (edge("independent01", 0, 1, (0, 0, 0), 1,
                       source="independent-witness"),
                  raw("raw01", (1, 0, 0), 1, source="signed-claims"),
                  edge("independent01_copy", 0, 1, (0, 0, 0), 1,
                       evidence_id="independent01", source="independent-witness"),
                  raw("forbidden_oracle", (0, 1, 2), 1, authorized=False),
                  raw("offline_oracle", (0, 1, 2), 1, available=False)), 0.1),
        Instance("coherent_false_account", 3, ("true", "false_coherent"),
                 (edge("base01", 0, 1, (0, 1)),
                  edge("base12", 1, 2, (0, 0)),
                  edge("base20", 2, 0, (0, -1))),
                 (edge("another_consistent01", 0, 1, (0, 1), 1),
                  raw("external_anchor", (0, 1), 2)), 0.1),
        Instance("head_length_collision", 3, ("head_A", "head_B"),
                 (edge("base01", 0, 1, (0, 0)),),
                 (edge("more_length12", 1, 2, (0, 0), 1),
                  edge("more_length20", 2, 0, (0, 0), 1),
                  raw("signed_head_inequality", (0, 1), 2)), 0.1),
        Instance("opposite_sign_same_scalar", 3,
                 ("positive01", "negative01"),
                 (edge("base01", 0, 1, (1, -1)),
                  edge("base12", 1, 2, (0, 0)),
                  edge("base20", 2, 0, (0, 0))), (), 0.1),
    )


def run_benchmark():
    results = []
    for instance in fixtures():
        validate(instance)
        choices = admitted(instance)
        for length in range(len(choices)):
            for subset in combinations(choices, length):
                old = distances(instance, subset)
                for packet in choices:
                    if packet not in subset:
                        new = distances(instance, subset + (packet,))
                        assert all(new[pair] + 1e-10 >= value
                                   for pair, value in old.items())
        rows = []
        for budget in (1, 2, 3):
            exact, ties, count = oracle(instance, budget)
            policies = {}
            for name, policy in (("exact", exact),
                                 ("cost_ranked", cost_ranked(instance, budget)),
                                 ("one_step", one_step(instance, budget)),
                                 ("two_step", two_step(instance, budget))):
                assert cost(policy) <= budget
                assert all(packet in choices for packet in policy)
                policies[name] = {"bundle": bundle_names(policy),
                                  "cost": cost(policy),
                                  "separated_pairs": score(instance, policy)[0],
                                  "min_distance_squared": score(instance, policy)[1]}
            rows.append({"budget": budget, "affordable_subsets": count,
                         "oracle_equal_score_equal_cost_ties": ties,
                         "policies": policies,
                         "random": random_exact(instance, budget)})
        results.append({"instance": instance.name, "vertices": instance.vertices,
                        "labels": instance.labels, "epsilon": instance.epsilon,
                        "base_distances_squared": distances(instance),
                        "admitted_candidates": bundle_names(admitted(instance)),
                        "excluded_candidates": [p.name for p in instance.candidates
                                                if p not in admitted(instance)],
                        "budgets": rows,
                        "one_pair_edge_only_cycle_certificate":
                        cheapest_unbalanced_cycle(instance)
                        if instance.name in ("triangle_zero_gain", "triangle_decoy")
                        else None})

    by_name = {item["instance"]: item for item in results}
    zero = by_name["triangle_zero_gain"]
    decoy = by_name["triangle_decoy"]
    assert np.isclose(zero["budgets"][2]["policies"]["exact"]["min_distance_squared"], 1 / 3)
    assert zero["budgets"][2]["policies"]["one_step"]["bundle"] == []
    assert zero["budgets"][2]["policies"]["two_step"]["bundle"] == ["a12", "b20"]
    assert decoy["budgets"][2]["policies"]["one_step"]["separated_pairs"] == 0
    assert decoy["budgets"][2]["policies"]["exact"]["separated_pairs"] == 1
    assert np.isclose(distances(fixtures()[1], (fixtures()[1].candidates[2],))[
        "consistent|declared_fault"], 1 / 32)
    assert by_name["location"]["base_distances_squared"]["fault01|fault12"] < 1e-12
    assert set(by_name["location"]["excluded_candidates"]) == {
        "independent01_copy", "forbidden_oracle", "offline_oracle"}
    location = fixtures()[2]
    q = location.candidates[0]
    q_copy = location.candidates[2]
    assert distances(location, (q, q_copy)) == distances(location, (q,))
    assert np.isclose(distances(location, (q,))["fault01|fault12"], 3 / 5)
    assert score(location, (location.candidates[1],))[0] == 3
    assert all(value < 1e-12 for value in
               by_name["coherent_false_account"]["base_distances_squared"].values())
    assert all(value < 1e-12 for value in
               by_name["head_length_collision"]["base_distances_squared"].values())
    signed = fixtures()[-1]
    plus = np.array([1., 0., 0.])
    minus = -plus
    matrix = np.array([[1., -1., 0.], [0., 1., -1.], [-1., 0., 1.]])
    assert np.isclose(np.linalg.norm(plus - matrix @ np.linalg.lstsq(matrix, plus, rcond=None)[0]),
                      np.linalg.norm(minus - matrix @ np.linalg.lstsq(matrix, minus, rcond=None)[0]))
    assert np.isclose(next(iter(distances(signed).values())), 4 / 3)
    return {"status": "synthetic exact enumeration", "score":
            "maximize robust separated pairs, then minimum squared vector distance; least cost and names break ties",
            "complete_projected_error_ball_radius": 0.1,
            "instances": results}


def main():
    print(json.dumps(run_benchmark(), indent=2))


if __name__ == "__main__":
    main()
