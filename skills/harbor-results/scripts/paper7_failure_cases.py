#!/usr/bin/env python3
"""Synthetic witnesses for Paper 7's failure-identifiability case table.

Each expected value is supplied by hand, then checked by an independent
least-squares projection. This does not simulate signed receipts or actors.
Run with Python + NumPy; no daemon, network, or model calls are involved.
"""

import json

import numpy as np


def incidence(vertices, edges):
    matrix = np.zeros((len(edges), vertices))
    for row, (source, target) in enumerate(edges):
        matrix[row, source] = 1
        matrix[row, target] = -1
    return matrix


def syndrome(matrix, readings):
    readings = np.asarray(readings, dtype=float)
    return readings - matrix @ np.linalg.lstsq(matrix, readings, rcond=None)[0]


def main():
    triangle = incidence(3, [(0, 1), (1, 2), (2, 0)])
    path = incidence(3, [(0, 1), (1, 2)])
    leaf = incidence(4, [(0, 1), (1, 2), (2, 0), (0, 3)])
    leaf_closed = incidence(4, [(0, 1), (1, 2), (2, 0), (0, 3), (1, 3)])
    repeated = np.vstack((triangle, triangle[0]))
    cases = []

    def record(name, matrix, left, right, expected_squared_distance):
        a, b = syndrome(matrix, left), syndrome(matrix, right)
        distance = float(np.dot(a - b, a - b))
        assert np.isclose(distance, expected_squared_distance, atol=1e-12), name
        cases.append({"case": name, "distance_squared": distance,
                      "expected_squared_distance": expected_squared_distance,
                      "same_scalar_radius": bool(np.isclose(np.linalg.norm(a),
                                                             np.linalg.norm(b))),
                      "same_projected_vector": bool(np.allclose(a, b))})

    record("cycle_fault_vs_consistency", triangle, [1, 0, 0], [0, 0, 0], 1/3)
    record("bridge_fault_vs_consistency", path, [1, 0], [0, 0], 0)
    record("uniform_sender_shift_vs_consistency", triangle, [1, 0, -1],
           [0, 0, 0], 0)
    record("articulation_split_vs_consistency", leaf, [1, 0, -1, 0],
           [0, 0, 0, 0], 0)
    record("articulation_split_after_honest_cross_link", leaf_closed,
           [1, 0, -1, 0, 0], [0, 0, 0, 0, 0], 3/8)
    record("coordinated_edge_offsets_vs_consistency", triangle, [1, -1, 0],
           [0, 0, 0], 0)
    record("different_fault_edges_same_syndrome", triangle, [1, 0, 0],
           [0, 1, 0], 0)
    record("fault_locations_after_trusted_remeasurement", repeated,
           [1, 0, 0, 0], [0, 1, 0, 0], 3/5)
    record("opposite_faults_same_radius_different_vectors", triangle,
           [1, 0, 0], [-1, 0, 0], 4/3)
    positive = syndrome(triangle, [1, 0, 0])
    negative = syndrome(triangle, [-1, 0, 0])
    assert np.isclose(np.linalg.norm(positive), np.linalg.norm(negative))
    assert not np.allclose(positive, negative)
    # Delete the first row: both hypotheses expose the same remaining readings.
    record("fault_on_unobserved_row", triangle[1:], [0, 0], [0, 0], 0)
    # A component-joining receipt has no immediate discriminatory power.
    bridge = incidence(4, [(0, 1), (1, 2)])
    record("first_component_link", bridge, [0, 9], [0, 0], 0)

    signal = syndrome(triangle, [1, 0, 0])
    epsilon = float(np.linalg.norm(signal) / 2)
    midpoint = signal / 2
    assert np.isclose(np.linalg.norm(midpoint), epsilon)
    assert np.isclose(np.linalg.norm(midpoint - signal), epsilon)
    assert np.allclose(syndrome(triangle, midpoint), midpoint)
    cases.append({"case": "noise_balls_touch", "epsilon": epsilon,
                  "distance": 2 * epsilon, "shared_midpoint": midpoint.tolist()})

    # A feature collision precedes projection; graph redundancy cannot undo it.
    raw_claims = [("head-A", 4), ("head-B", 4)]
    encoded = [claim[1] for claim in raw_claims]
    assert raw_claims[0][0] != raw_claims[1][0] and encoded[0] == encoded[1]
    cases.append({"case": "head_length_feature_collision",
                  "different_heads": True, "same_encoded_value": True})

    # Two individually uninformative queries can jointly close a cycle.
    base = incidence(3, [(0, 1)])
    first = incidence(3, [(0, 1), (1, 2)])
    second = incidence(3, [(0, 1), (2, 0)])
    values = [float(np.dot(syndrome(matrix, data), syndrome(matrix, data)))
              for matrix, data in ((base, [0]), (first, [0, 1]),
                                   (second, [0, 0]), (triangle, [0, 1, 0]))]
    assert np.allclose(values, [0, 0, 0, 1/3])
    assert values[1] + values[2] < values[0] + values[3] - 1e-12
    cases.append({"case": "query_complementarity_refutes_submodularity",
                  "squared_gains_empty_e_f_both": values})
    print(json.dumps({"evidence": "synthetic numerical witnesses", "cases": cases}, indent=2))


if __name__ == "__main__":
    main()
