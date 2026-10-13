"""Tests for the bounded, deterministic sheaf observability fixture."""

import sys
import unittest
import json
from fractions import Fraction
from itertools import combinations, product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import sheaf_observability_study as study


def exact_rank(columns):
    """Rational row reduction, independent of graph cut/deletion code."""
    if not columns:
        return 0
    rows = [list(row) for row in zip(*columns, strict=True)]
    pivot_row = 0
    for column in range(len(columns)):
        pivot = next((row for row in range(pivot_row, len(rows)) if rows[row][column]), None)
        if pivot is None:
            continue
        rows[pivot_row], rows[pivot] = rows[pivot], rows[pivot_row]
        scale = rows[pivot_row][column]
        rows[pivot_row] = [value / scale for value in rows[pivot_row]]
        for row in range(len(rows)):
            if row != pivot_row:
                factor = rows[row][column]
                rows[row] = [a - factor * b for a, b in zip(rows[row], rows[pivot_row], strict=True)]
        pivot_row += 1
        if pivot_row == len(rows):
            break
    return pivot_row


class ObservabilityStudyTests(unittest.TestCase):
    def test_exact_projection_agrees_with_independent_constraint_oracle(self):
        edges = study.SQUARE_DIAGONAL
        clean = study.clean_claims(edges)
        for perturbation in product((-1, 0, 1), repeat=len(edges)):
            y = study.observations(study.perturb_edges(clean, perturbation))
            feasible = study.consistency_oracle(edges, y)
            energy = study.projection_energy(edges, y)
            self.assertEqual(feasible, energy == 0, perturbation)
            self.assertGreaterEqual(energy, 0)

    def test_clean_unequal_counts_are_consistent(self):
        result = study.inspect(study.clean_claims(study.SQUARE_DIAGONAL), study.SQUARE_DIAGONAL)
        self.assertEqual(result["projection_energy"], "0")
        self.assertTrue(result["compatible"])
        self.assertFalse(result["duplicate_claim_alarm"])
        self.assertFalse(result["ledger_disagreement"])

    def test_nonzero_endpoint_disagreement_is_not_a_cycle_obstruction(self):
        edges = ((0, 1), (1, 2), (0, 2))
        values = (0, 1, 2)
        observed = tuple(values[v] - values[u] for u, v in edges)
        self.assertEqual(observed, (1, 1, 2))
        self.assertEqual(sum(value * value for value in observed), 6)
        self.assertTrue(study.consistency_oracle(edges, observed))
        self.assertEqual(study.projection_energy(edges, observed), 0)

    def test_single_cycle_edge_fault_is_detected(self):
        claims = study.perturb_edges(study.clean_claims(study.SQUARE_DIAGONAL), (1, 0, 0, 0, 0))
        result = study.inspect(claims, study.SQUARE_DIAGONAL)
        self.assertFalse(result["compatible"])
        self.assertNotEqual(result["projection_energy"], "0")
        self.assertTrue(result["ledger_disagreement"])

    def test_bridge_fault_is_invisible_to_projection(self):
        claims = study.perturb_edges(study.clean_claims(study.TRIANGLE_TAIL), (0, 0, 0, 1))
        result = study.inspect(claims, study.TRIANGLE_TAIL)
        self.assertTrue(result["compatible"])
        self.assertEqual(result["projection_energy"], "0")
        self.assertTrue(result["ledger_disagreement"])

    def test_gradient_and_consistent_wrong_claims_are_invisible(self):
        result = study.run_study()["cases"]
        for name in ("gradient_collusion", "consistent_but_wrong"):
            self.assertTrue(result[name]["compatible"])
            self.assertEqual(result[name]["projection_energy"], "0")
            self.assertFalse(result[name]["duplicate_claim_alarm"])
            self.assertTrue(result[name]["ledger_disagreement"])

    def test_stale_or_missing_evidence_abstains(self):
        cases = study.run_study()["cases"]
        expected = {
            "stale_watermark": "missing-or-mismatched-metadata",
            "stale_schema": "missing-or-mismatched-metadata",
            "stale_work_item": "missing-or-mismatched-metadata",
            "missing_metadata": "missing-or-mismatched-metadata",
            "duplicate_packet": "duplicate-packet-id",
            "missing_evidence": "missing-evidence-ref",
            "duplicate_evidence": "duplicate-evidence-ref",
            "missing_edge": "missing-or-reordered-edge",
        }
        for name, reason in expected.items():
            self.assertEqual(cases[name]["status"], "abstain")
            self.assertEqual(cases[name]["reason"], reason)

    def test_blank_packet_and_evidence_references_abstain(self):
        clean = study.clean_claims(study.SQUARE_DIAGONAL)
        from dataclasses import replace

        for field, reason in (("packet_id", "missing-packet-id"), ("evidence_ref", "missing-evidence-ref")):
            claims = (replace(clean[0], **{field: "   "}),) + clean[1:]
            self.assertEqual(study.inspect(claims, study.SQUARE_DIAGONAL)["reason"], reason)

    def test_exhaustive_study_reports_baseline_advantage(self):
        counts = study.run_study()["exhaustive"]
        self.assertEqual(counts["perturbations"], 243)
        self.assertEqual(counts["projection_oracle_disagreements"], 0)
        self.assertEqual(counts["ledger_disagreement"], 242)
        self.assertGreater(counts["duplicate_ledger_true_positive"], counts["projection_ledger_true_positive"])
        self.assertEqual(counts["duplicate_ledger_false_positive"], 0)

    def test_signature_map_is_linear_and_annihilates_vertex_shifts(self):
        edges = study.SQUARE_DIAGONAL
        first = (1, 0, 0, 0, 0)
        second = (0, -1, 0, 1, 0)
        combined = tuple(a + b for a, b in zip(first, second, strict=True))
        left = study.projection_signature(edges, combined)
        right = tuple(a + b for a, b in zip(
            study.projection_signature(edges, first),
            study.projection_signature(edges, second), strict=True))
        self.assertEqual(left, right)
        potential = (2, 5, 1, 4)
        gradient = tuple(potential[v] - potential[u] for u, v in edges)
        self.assertEqual(study.projection_signature(edges, gradient), (Fraction(0),) * len(edges))

    def test_exact_signature_degeneracy_and_added_edge_resolution(self):
        original = study.signature_identifiability(study.SQUARE_DIAGONAL)
        extended = study.signature_identifiability(study.SQUARE_DIAGONAL_PLUS_EDGE)
        self.assertEqual(original["label_count"], 11)
        self.assertEqual(original["distinct_signature_count"], 7)
        self.assertEqual(original["indistinguishable_classes"], [
            ["edge-0:-1", "edge-1:-1"],
            ["edge-0:+1", "edge-1:+1"],
            ["edge-2:-1", "edge-3:+1"],
            ["edge-2:+1", "edge-3:-1"],
        ])
        self.assertEqual(original["minimum_label_separation_squared"], "0")
        self.assertEqual(original["minimum_distinct_class_separation_squared"], "3/8")
        self.assertEqual(extended["label_count"], 11)
        self.assertEqual(extended["distinct_signature_count"], 11)
        self.assertEqual(extended["indistinguishable_classes"], [])
        self.assertEqual(extended["minimum_label_separation_squared"], "1/2")
        self.assertEqual(extended["robust_nearest_class_radius_squared"], "1/8")
        pairwise = study.run_study()["identifiability"]["fixed_label_pairwise_comparison"]
        self.assertEqual(pairwise["pairs"], 55)
        self.assertEqual(pairwise["smaller_after_added_edge"], 0)
        self.assertEqual(pairwise["degenerate_pairs_resolved"], 4)

    def test_strict_projected_noise_bound_preserves_nearest_class(self):
        for edges in (study.SQUARE_DIAGONAL, study.SQUARE_DIAGONAL_PLUS_EDGE):
            library = study.signature_library(edges)
            classes = set(library.values())
            margin = Fraction(study.signature_identifiability(edges)["minimum_distinct_class_separation_squared"])
            noise = study.projection_signature(edges, (Fraction(1, 16),) + (0,) * (len(edges) - 1))
            noise_energy = sum(value * value for value in noise)
            self.assertLess(noise_energy, margin / 4)
            for target in classes:
                observation = tuple(a + b for a, b in zip(target, noise, strict=True))
                distances = {candidate: study.squared_distance(observation, candidate) for candidate in classes}
                self.assertEqual(min(distances, key=distances.get), target)
            # At the open-boundary midpoint, two closest classes can tie.
            nearest_pair = min(
                ((a, b) for a in classes for b in classes if a != b),
                key=lambda pair: study.squared_distance(*pair),
            )
            midpoint = tuple((a + b) / 2 for a, b in zip(*nearest_pair, strict=True))
            self.assertEqual(study.squared_distance(midpoint, nearest_pair[0]), margin / 4)
            self.assertEqual(study.squared_distance(midpoint, nearest_pair[1]), margin / 4)

    def test_active_audit_probe_uses_same_labels_and_reports_all_maximizers(self):
        result = study.active_audit_probe_design()
        self.assertEqual(len(result["candidates"]), 6)
        self.assertEqual(result["all_maximizers"], ["new-cross-edge-1-3"])
        self.assertEqual(result["maximin_margin_squared"], "1/2")
        self.assertTrue(all(row["minimum_label_separation_squared"] == "0"
                            for row in result["candidates"][1:]))

    def test_finite_codebook_classification_abstains_on_degeneracy_and_outliers(self):
        old = study.classify_report_mutation(study.SQUARE_DIAGONAL, (1, 0, 0, 0, 0), Fraction(0))
        self.assertEqual(old["status"], "ambiguous")
        self.assertEqual(old["candidate_classes"][0]["labels"], ["edge-0:+1", "edge-1:+1"])
        extended = study.classify_report_mutation(
            study.SQUARE_DIAGONAL_PLUS_EDGE, (1, 0, 0, 0, 0, 0), Fraction(1, 16))
        self.assertEqual(extended["status"], "identified_report_mutation")
        self.assertEqual(extended["label"], "edge-0:+1")
        outlier = study.classify_report_mutation(study.SQUARE_DIAGONAL, (2, 0, 0, 0, 0), Fraction(0))
        self.assertEqual(outlier["status"], "out_of_library")
        self.assertEqual(outlier["nearest_class_distance_squared"], "3/8")

    def test_midpoint_at_radius_boundary_is_ambiguous(self):
        edges = study.SQUARE_DIAGONAL_PLUS_EDGE
        library = study.signature_library(edges)
        signatures = list(library.values())
        margin = Fraction(study.signature_identifiability(edges)["minimum_label_separation_squared"])
        pair = min(((a, b) for a in signatures for b in signatures if a != b),
                   key=lambda item: study.squared_distance(*item))
        midpoint = tuple((a + b) / 2 for a, b in zip(*pair, strict=True))
        result = study.classify_report_mutation(edges, midpoint, margin / 4)
        self.assertEqual(result["status"], "ambiguous")
        self.assertGreaterEqual(len(result["candidate_classes"]), 2)
        self.assertEqual(result["nearest_class_distance_squared"], "1/8")

    def test_signed_single_edge_signatures_iff_three_edge_connected_on_four_vertices(self):
        all_edges = tuple(combinations(range(4), 2))

        def connected_after_removal(edges, removed):
            adjacency = [set() for _ in range(4)]
            for index, (u, v) in enumerate(edges):
                if index not in removed:
                    adjacency[u].add(v)
                    adjacency[v].add(u)
            seen = {0}
            pending = [0]
            while pending:
                for neighbor in adjacency[pending.pop()]:
                    if neighbor not in seen:
                        seen.add(neighbor)
                        pending.append(neighbor)
            return len(seen) == 4

        connected_count = 0
        three_edge_connected_count = 0
        unique_signature_count = 0
        for mask in range(1 << len(all_edges)):
            edges = tuple(edge for index, edge in enumerate(all_edges) if mask & (1 << index))
            if not connected_after_removal(edges, set()):
                continue
            connected_count += 1
            three_edge_connected = all(
                connected_after_removal(edges, set(removed))
                for cut_size in (1, 2)
                for removed in combinations(range(len(edges)), cut_size)
            )
            signatures = {(Fraction(0),) * len(edges)}
            for index in range(len(edges)):
                basis = tuple(1 if position == index else 0 for position in range(len(edges)))
                signature = study.projection_signature(edges, basis)
                signatures.add(signature)
                signatures.add(tuple(-value for value in signature))
            unique_signatures = len(signatures) == 1 + 2 * len(edges)
            self.assertEqual(three_edge_connected, unique_signatures, edges)
            three_edge_connected_count += three_edge_connected
            unique_signature_count += unique_signatures
        self.assertEqual(connected_count, 38)
        self.assertEqual(three_edge_connected_count, 1)
        self.assertEqual(unique_signature_count, 1)

    def test_native_explorer_fixture_matches_exact_study(self):
        resource = (Path(__file__).resolve().parents[1] /
                    "docs/harbor-research/SwarmVisualizer/Sources/SwarmVisualizer/Resources/observability_fixture.json")
        fixture = json.loads(resource.read_text())
        result = study.run_study()
        self.assertEqual((fixture["feature"], fixture["workItem"], fixture["schemaVersion"],
                          fixture["watermark"], fixture["sourceRoot"]),
                         (study.FEATURE, study.WORK_ITEM, study.SCHEMA_VERSION,
                          study.WATERMARK, study.SOURCE_ROOT))
        for graph in fixture["graphs"]:
            edges = tuple(map(tuple, graph["edges"]))
            scores = study.signature_identifiability(edges, 5)
            self.assertEqual(graph["edgeConnectivity"], study.edge_connectivity(edges))
            signatures = study.signature_library(edges, 5)
            self.assertEqual(graph["labelCount"], scores["label_count"])
            self.assertEqual(graph["classCount"], scores["distinct_signature_count"])
            self.assertEqual(graph["minimumMarginSquared"], scores["minimum_label_separation_squared"])
            self.assertEqual(graph["distinctMarginSquared"], scores["minimum_distinct_class_separation_squared"])
            self.assertEqual(graph["robustRadiusSquared"], scores["robust_nearest_class_radius_squared"])
            self.assertEqual({label["id"] for label in graph["labels"]}, set(signatures))
            for label in graph["labels"]:
                signature = signatures[label["id"]]
                self.assertEqual(label["vector"], [str(value) for value in signature])
                self.assertEqual(label["normSquared"], str(sum(value * value for value in signature)))
                self.assertEqual(label["classLabels"],
                                 [name for name, value in signatures.items() if value == signature])
        probe_rows = study.active_audit_probe_design()["candidates"]
        self.assertEqual([(row["id"], row["edge"], row["classCount"], row["minimumMarginSquared"])
                          for row in fixture["probes"]],
                         [(row["probe"], row["edge"], row["distinct_signature_count"],
                           row["minimum_label_separation_squared"]) for row in probe_rows])
        counts = result["exhaustive"]
        self.assertEqual((fixture["perturbations"], fixture["ledgerDisagreements"],
                          fixture["duplicateDetections"], fixture["cycleDetections"]),
                         (counts["perturbations"], counts["ledger_disagreement"],
                          counts["duplicate_ledger_true_positive"],
                          counts["projection_ledger_true_positive"]))

    def test_sparse_cut_threshold_against_independent_rational_rank_oracle(self):
        all_edges = tuple(combinations(range(4), 2))
        graph_count = 0
        for mask in range(1 << len(all_edges)):
            edges = tuple(edge for index, edge in enumerate(all_edges) if mask & (1 << index))
            if not study.consistency_oracle(edges, (0,) * len(edges)):
                self.fail("zero edge differences must always be consistent")
            # Independent adjacency traversal to select connected graphs.
            seen = {0}
            while True:
                expanded = seen | {v for u, v in edges if u in seen} | {u for u, v in edges if v in seen}
                if expanded == seen:
                    break
                seen = expanded
            if len(seen) != 4:
                continue
            graph_count += 1
            columns = [study.projection_signature(
                edges, tuple(int(position == index) for position in range(len(edges))))
                for index in range(len(edges))]
            for k in (1, 2):
                s = min(2 * k, len(edges))
                independent = all(
                    exact_rank([columns[index] for index in support]) == size
                    for size in range(1, s + 1)
                    for support in combinations(range(len(edges)), size)
                )
                self.assertEqual(independent, study.edge_connectivity(edges) > 2 * k, (edges, k))
                witness = study.sparse_kernel_witness(edges, 2 * k)
                self.assertEqual(independent, witness is None, (edges, k))
                if witness is not None:
                    self.assertGreater(sum(value != 0 for value in witness), 0)
                    self.assertLessEqual(sum(value != 0 for value in witness), 2 * k)
                    self.assertEqual(study.projection_signature(edges, witness),
                                     (Fraction(0),) * len(edges))
        self.assertEqual(graph_count, 38)

    def test_public_and_native_explorers_share_exact_fixture(self):
        root = Path(__file__).resolve().parents[1]
        native = root / "docs/harbor-research/SwarmVisualizer/Sources/SwarmVisualizer/Resources/observability_fixture.json"
        web = root / "website-v2/public/research/sheaf-visualizer/fixture.json"
        self.assertEqual(web.read_bytes(), native.read_bytes())
        fixture = json.loads(native.read_text())
        self.assertIn("graphs", fixture)

    def test_parallel_edges_count_separately_and_k4_has_two_sparse_collision(self):
        parallel = ((0, 1), (0, 1), (0, 1))
        self.assertEqual(study.edge_connectivity(parallel, vertices=2), 3)
        self.assertIsNone(study.sparse_kernel_witness(parallel, 2, vertices=2))
        self.assertEqual(study.sparse_kernel_witness(parallel, 3, vertices=2),
                         (Fraction(-1),) * 3)
        result = study.run_study()["sparse_edge_error_identifiability"]
        collision = result["k4_two_sparse_collision"]
        edges = tuple(map(tuple, collision["edges"]))
        a = tuple(map(Fraction, collision["a"]))
        b = tuple(map(Fraction, collision["b"]))
        self.assertEqual(collision["edge_connectivity"], 3)
        self.assertNotEqual(a, b)
        self.assertLessEqual(sum(value != 0 for value in a), 2)
        self.assertLessEqual(sum(value != 0 for value in b), 2)
        self.assertEqual(study.projection_signature(edges, a), study.projection_signature(edges, b))
        self.assertEqual(result["four_vertex_simple_graph_search"], {
            "connected_graphs": 38, "k_1_identifiable": 1,
            "k_2_identifiable": 0, "cut_witness_disagreements": 0,
        })


if __name__ == "__main__":
    unittest.main()
