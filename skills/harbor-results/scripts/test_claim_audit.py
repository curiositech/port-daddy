"""Independent finite-oracle and adversarial checks for the offline claim audit.

The exhaustive sweep enumerates all 3-edge observation states on K3: an edge is
unobserved or has one of k squared reciprocal value pairs. Thus k=2 covers
5**3=125 tables and k=3 covers 10**3=1,000 tables. The oracle enumerates
all k**3 categorical vertex assignments directly from the directed messages;
it does not reuse the audit's union-find or its emitted differences.
"""

from __future__ import annotations

import copy
import importlib.util
import itertools
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tracemalloc
import unittest


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "claim_audit.py"
SPEC = importlib.util.spec_from_file_location("claim_audit_under_test", SOURCE)
assert SPEC is not None and SPEC.loader is not None
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)

TRIANGLE = (("A", "B"), ("A", "C"), ("B", "C"))


def document(*, agents=("A", "B", "C"), edges=TRIANGLE, facts=None,
             table=None, snapshot="revision-1"):
    """Build retained directed receipts; None means neither direction exists."""
    if facts is None:
        facts = {"f": ["a", "b"]}
    if table is None:
        table = {}
    messages = []
    for fact, rows in table.items():
        for edge_index, (u, v) in enumerate(edges):
            pair = rows.get((u, v))
            if pair is None:
                continue
            forward, reverse = pair
            if forward is not None:
                messages.append({"receipt": f"{fact}:{edge_index}:forward",
                                 "snapshot": snapshot, "fact": fact,
                                 "value": forward, "sender": u, "receiver": v})
            if reverse is not None:
                messages.append({"receipt": f"{fact}:{edge_index}:reverse",
                                 "snapshot": snapshot, "fact": fact,
                                 "value": reverse, "sender": v, "receiver": u})
    return {"snapshot": snapshot, "facts": facts, "agents": list(agents),
            "edges": [list(e) for e in edges], "messages": messages}


def finite_assignment_oracle(edges, rows, alphabet, agents=("A", "B", "C")):
    """Search raw directed-message constraints, independently of audit output."""
    for labels in itertools.product(alphabet, repeat=len(agents)):
        assignment = dict(zip(agents, labels))
        if assignment_satisfies(assignment, edges, rows):
            return assignment
    return None


def assignment_satisfies(assignment, edges, rows):
    for u, v in edges:
        pair = rows.get((u, v))
        if pair is None or None in pair:
            continue
        forward, reverse = pair
        if forward == reverse and assignment[u] != assignment[v]:
            return False
        if forward != reverse and (assignment[u], assignment[v]) != pair:
            return False
    return True


def fact_result(result, fact="f"):
    return result["facts"][fact]


def feasible(result, fact="f"):
    return fact_result(result, fact)["categorical"]["feasible"]


def certificate(result, fact="f"):
    return fact_result(result, fact)["categorical"].get("certificate")


def require_small_hodge(test, result, fact="f"):
    hodge = fact_result(result, fact)["hodge"]
    if hodge["status"] == "unavailable":
        test.assertEqual(hodge["reason"], "numpy unavailable")
        test.skipTest("NumPy is unavailable to optional Hodge diagnostics")
    test.assertEqual(hodge["status"], "ok")
    return hodge


class ClaimAuditContract(unittest.TestCase):
    def test_exhaustive_three_vertex_categorical_oracle(self):
        examined = 0
        infeasible = 0
        for alphabet in (("a", "b"), ("a", "b", "c")):
            edge_states = (None,) + tuple(itertools.product(alphabet, repeat=2))
            for states in itertools.product(edge_states, repeat=3):
                rows = {e: state for e, state in zip(TRIANGLE, states)}
                data = document(facts={"f": list(alphabet)}, table={"f": rows})
                expected = finite_assignment_oracle(TRIANGLE, rows, alphabet)
                result = AUDIT.audit_document(data)
                actual = feasible(result)
                self.assertEqual(expected is not None, actual,
                                 f"categorical mismatch alphabet={alphabet} states={states}")
                differences = fact_result(result)["differences"]
                self.assertEqual(sum(state is not None for state in states),
                                 len(differences),
                                 f"missing or invented reciprocal edge states={states}")
                coverage = fact_result(result)["coverage"]
                self.assertEqual(coverage["observed_edges"],
                                 [list(e) for e, state in zip(TRIANGLE, states)
                                  if state is not None],
                                 f"incorrect observed-edge mask states={states}")
                self.assertEqual(coverage["missing_edges"],
                                 [list(e) for e, state in zip(TRIANGLE, states)
                                  if state is None],
                                 f"incorrect missing-edge mask states={states}")
                if actual:
                    self.assertIsNone(certificate(result),
                                      f"feasible table has certificate states={states}")
                    assignment = fact_result(result)["categorical"]["assignment"]
                    self.assertEqual(set(assignment), {"A", "B", "C"})
                    self.assertTrue(set(assignment.values()) <= set(alphabet))
                    self.assertTrue(assignment_satisfies(assignment, TRIANGLE, rows),
                                    f"returned assignment violates raw constraints states={states}")
                else:
                    infeasible += 1
                    self.assertTrue(AUDIT.verify_certificate(differences, certificate(result)),
                                    f"unverifiable certificate states={states}")
                examined += 1
        self.assertEqual(examined, 1125)
        self.assertGreater(infeasible, 0)
        print(f"EXHAUSTIVE_CATEGORICAL_TABLES={examined} INFEASIBLE={infeasible}")

    def test_consistent_partial_triangle_is_not_zero_filled(self):
        rows = {("A", "B"): ("a", "b"),
                ("A", "C"): (None, "b"),
                ("B", "C"): ("b", "b")}
        result = AUDIT.audit_document(document(table={"f": rows}), hodge=True)
        self.assertTrue(feasible(result))
        self.assertEqual({tuple(d["edge"]) for d in fact_result(result)["differences"]},
                         {("A", "B"), ("B", "C")})
        self.assertEqual(require_small_hodge(self, result)["triangles"], [],
                         "an unobserved edge cannot close a triangle")
        self.assertEqual(require_small_hodge(self, result)["witness_triangles"], [])

    def test_visibility_mask_is_per_fact(self):
        f = {("A", "B"): ("a", "b"), ("A", "C"): (None, "b"),
             ("B", "C"): ("b", "b")}
        h = {e: ("x", "x") for e in TRIANGLE}
        result = AUDIT.audit_document(document(facts={"f": ["a", "b"],
                                                      "h": ["x", "y"]},
                                               table={"f": f, "h": h}), hodge=True)
        self.assertEqual(len(fact_result(result, "f")["differences"]), 2)
        self.assertEqual(len(fact_result(result, "h")["differences"]), 3)
        self.assertTrue(feasible(result, "f"))
        self.assertTrue(feasible(result, "h"))
        self.assertEqual(require_small_hodge(self, result, "f")["triangles"], [])

    def test_onehot_path_infeasible_even_when_real_residual_zero(self):
        edges = (("A", "B"), ("B", "C"))
        rows = {edges[0]: ("a", "b"), edges[1]: ("a", "b")}
        result = AUDIT.audit_document(document(edges=edges, table={"f": rows}),
                                      hodge=True)
        self.assertFalse(feasible(result))
        self.assertTrue(AUDIT.verify_certificate(fact_result(result)["differences"],
                                                 certificate(result)))
        self.assertAlmostEqual(require_small_hodge(self, result)["residual_norm"], 0.0,
                               places=9)

    def test_truthful_partition_and_consistent_falsehood_have_no_alarm(self):
        for labels in ({"A": "a", "B": "b", "C": "b"},
                       {"A": "b", "B": "b", "C": "b"}):
            rows = {e: (labels[e[0]], labels[e[1]]) for e in TRIANGLE}
            result = AUDIT.audit_document(document(table={"f": rows}))
            self.assertTrue(feasible(result))
            self.assertEqual(fact_result(result)["direct_sender_inconsistencies"], [],
                             "consistent claims are not externally validated truth")

    def test_common_value_erasure_hides_raw_sender_split(self):
        # Every observed difference is zero, yet A sent a to B and b to C.
        rows = {("A", "B"): ("a", "a"),
                ("A", "C"): ("b", "b")}
        result = AUDIT.audit_document(document(table={"f": rows}))
        self.assertTrue(feasible(result))
        self.assertTrue(all(d["kind"] == "zero" for d in fact_result(result)["differences"]))
        self.assertNotEqual(fact_result(result)["direct_sender_inconsistencies"], [],
                            "raw sender comparison must retain the split")
        self.assertTrue(all("value" not in d for d in fact_result(result)["differences"]),
                        "zero differences must erase their common raw value")

    def test_reversed_registered_edge_canonical_orientation(self):
        edges = (("B", "A"),)
        rows = {edges[0]: ("b", "a")}
        result = AUDIT.audit_document(document(agents=("A", "B"), edges=edges,
                                               table={"f": rows}))
        d = fact_result(result)["differences"][0]
        self.assertEqual(d["edge"], ["A", "B"])
        self.assertEqual((d["tail"], d["head"]), ("a", "b"))

    def test_empty_and_disconnected_observations_with_singleton_alphabet(self):
        data = document(agents=("A", "B", "C", "D"),
                        edges=(("A", "B"), ("C", "D")),
                        facts={"f": ["only"]}, table={})
        result = AUDIT.audit_document(data)
        self.assertTrue(feasible(result))
        self.assertEqual(fact_result(result)["differences"], [])
        self.assertIsNone(certificate(result))
        self.assertEqual(fact_result(result)["direct_sender_inconsistencies"], [])
        data["messages"] = [
            {"receipt": "r1", "snapshot": "revision-1", "fact": "f",
             "value": "only", "sender": "A", "receiver": "B"},
            {"receipt": "r2", "snapshot": "revision-1", "fact": "f",
             "value": "only", "sender": "B", "receiver": "A"},
        ]
        result = AUDIT.audit_document(data)
        self.assertEqual(len(fact_result(result)["differences"]), 1)
        self.assertTrue(feasible(result))

    def test_snapshot_fact_value_and_endpoint_validation(self):
        base = document(edges=(("A", "B"),), table={"f": {("A", "B"): ("a", "b")}})
        mutations = []
        for field, value in (("snapshot", "revision-2"), ("fact", "unknown"),
                             ("value", "unknown"), ("receiver", "C"),
                             ("sender", "unknown")):
            changed = copy.deepcopy(base)
            changed["messages"][0][field] = value
            mutations.append((field, changed))
        for field, changed in mutations:
            with self.subTest(field=field), self.assertRaises(ValueError):
                AUDIT.audit_document(changed)

    def test_repeated_receipts_deduplicate_but_conflicts_reject(self):
        base = document(edges=(("A", "B"),), table={"f": {("A", "B"): ("a", "b")}})
        duplicated = copy.deepcopy(base)
        duplicated["messages"].append(copy.deepcopy(duplicated["messages"][0]))
        conflicting = copy.deepcopy(base)
        changed = copy.deepcopy(conflicting["messages"][0])
        changed["receipt"] = "new-receipt"
        changed["value"] = "b"
        conflicting["messages"].append(changed)
        self.assertEqual(AUDIT.audit_document(duplicated), AUDIT.audit_document(base),
                         "exact replay must not add a second observation")
        reused = copy.deepcopy(base)
        reused["messages"].append(copy.deepcopy(reused["messages"][0]))
        reused["messages"][-1]["value"] = "b"
        for name, data in (("conflicting receipt reuse", reused),
                           ("conflicting direction", conflicting)):
            with self.subTest(name=name), self.assertRaises(ValueError):
                AUDIT.audit_document(data)

    def test_certificate_tamper_replay_and_irrelevant_edges(self):
        edges = (("A", "B"), ("B", "C"))
        rows = {edges[0]: ("a", "b"), edges[1]: ("a", "b")}
        result = AUDIT.audit_document(document(edges=edges, table={"f": rows}))
        differences = fact_result(result)["differences"]
        good = certificate(result)
        self.assertTrue(AUDIT.verify_certificate(differences, good))
        variants = []
        for field, value in (("fact", "h"), ("snapshot", "revision-2")):
            bad = copy.deepcopy(good)
            bad[field] = value
            variants.append((f"replayed {field}", bad))
        bad = copy.deepcopy(good)
        bad["pins"][0]["value"] = "b" if bad["pins"][0]["value"] == "a" else "a"
        variants.append(("changed pin", bad))
        bad = copy.deepcopy(good)
        bad["pins"][0]["receipts"] = ["forged", "receipt"]
        variants.append(("forged pin receipt", bad))
        bad = copy.deepcopy(good)
        bad["zero_path"].append({"edge": ["A", "C"], "receipts": ["x", "y"]})
        variants.append(("irrelevant nonexistent path edge", bad))
        for name, bad in variants:
            with self.subTest(name=name):
                self.assertFalse(AUDIT.verify_certificate(differences, bad), name)

        reused_rows = copy.deepcopy(differences)
        reused_cert = copy.deepcopy(good)
        reused_rows[1]["receipts"] = reused_rows[0]["receipts"][:]
        for pin in reused_cert["pins"]:
            if pin["edge"] == reused_rows[1]["edge"]:
                pin["receipts"] = reused_rows[1]["receipts"][:]
        self.assertFalse(AUDIT.verify_certificate(reused_rows, reused_cert),
                         "one receipt ID cannot authenticate two different edges")

    def test_zero_path_certificate_checks_each_retained_edge(self):
        edges = (("A", "B"), ("B", "C"), ("C", "D"))
        rows = {edges[0]: ("a", "b"), edges[1]: ("b", "b"),
                edges[2]: ("a", "b")}
        result = AUDIT.audit_document(document(agents=("A", "B", "C", "D"),
                                               edges=edges, table={"f": rows}))
        self.assertFalse(feasible(result))
        differences = fact_result(result)["differences"]
        good = certificate(result)
        self.assertTrue(AUDIT.verify_certificate(differences, good))
        self.assertGreater(len(good["zero_path"]), 0,
                           "fixture must require equality-path evidence")
        bad = copy.deepcopy(good)
        bad["zero_path"][0]["receipts"] = ["forged", "receipt"]
        self.assertFalse(AUDIT.verify_certificate(differences, bad))
        bad = copy.deepcopy(good)
        bad["zero_path"] = []
        self.assertFalse(AUDIT.verify_certificate(differences, bad))

    def test_hodge_bridge_metric_is_undefined(self):
        edges = (("A", "B"), ("B", "C"))
        rows = {edges[0]: ("a", "b"), edges[1]: ("a", "b")}
        result = AUDIT.audit_document(document(edges=edges, table={"f": rows}),
                                      hodge=True)
        hodge = require_small_hodge(self, result)
        self.assertAlmostEqual(hodge["residual_norm"], 0.0, places=9)
        self.assertEqual(hodge["triangles"], [])
        self.assertEqual(hodge["witness_triangles"], [])
        self.assertIsNone(hodge["legibility_ratio"],
                          "zero residual denominator leaves L undefined")
        for edge in hodge["edges"]:
            self.assertTrue(edge["bridge"])
            self.assertAlmostEqual(edge["effective_resistance"], 1.0, places=9)
            self.assertAlmostEqual(edge["cycle_sensitivity"], 0.0, places=9)
            self.assertAlmostEqual(edge["curl_leverage"], 0.0, places=9)
            self.assertAlmostEqual(edge["harmonic_leverage"], 0.0, places=9)
            self.assertIsNone(edge["legibility_ratio"])

    def test_triangle_curl_and_bare_cycle_harmonic_are_distinct(self):
        triangle_rows = {("A", "B"): ("a", "b"),
                         ("B", "C"): ("a", "b"),
                         ("A", "C"): ("a", "a")}
        triangle = AUDIT.audit_document(document(table={"f": triangle_rows}),
                                        hodge=True)
        tri_hodge = require_small_hodge(self, triangle)
        self.assertFalse(feasible(triangle))
        self.assertEqual(tri_hodge["triangles"], [["A", "B", "C"]])
        self.assertEqual(tri_hodge["witness_triangles"], [["A", "B", "C"]])
        self.assertGreater(tri_hodge["curl_norm"], 0.1)
        self.assertAlmostEqual(tri_hodge["harmonic_norm"], 0.0, places=9)
        self.assertAlmostEqual(tri_hodge["legibility_ratio"], 0.0, places=9)
        for edge in tri_hodge["edges"]:
            self.assertFalse(edge["bridge"])
            self.assertAlmostEqual(edge["effective_resistance"], 2 / 3, places=9)
            self.assertAlmostEqual(edge["cycle_sensitivity"], (1 / 3) ** 0.5,
                                   places=9)
            self.assertAlmostEqual(edge["curl_leverage"], 1 / 3, places=9)
            self.assertAlmostEqual(edge["harmonic_leverage"], 0.0, places=9)
            self.assertAlmostEqual(edge["legibility_ratio"], 0.0, places=9)

        consistent_rows = {("A", "B"): ("a", "b"),
                           ("A", "C"): ("a", "b"),
                           ("B", "C"): ("b", "b")}
        consistent = AUDIT.audit_document(document(table={"f": consistent_rows}),
                                          hodge=True)
        consistent_hodge = require_small_hodge(self, consistent)
        self.assertEqual(consistent_hodge["triangles"], [["A", "B", "C"]])
        self.assertEqual(consistent_hodge["witness_triangles"], [],
                         "a topological triangle is not itself a contradiction witness")

        square_edges = (("A", "B"), ("B", "C"), ("C", "D"), ("A", "D"))
        square_rows = {square_edges[0]: ("a", "b"),
                       square_edges[1]: ("b", "b"),
                       square_edges[2]: ("b", "b"),
                       square_edges[3]: ("a", "a")}
        square = AUDIT.audit_document(document(agents=("A", "B", "C", "D"),
                                               edges=square_edges,
                                               table={"f": square_rows}),
                                      hodge=True)
        square_hodge = require_small_hodge(self, square)
        self.assertFalse(feasible(square))
        self.assertEqual(square_hodge["triangles"], [])
        self.assertEqual(square_hodge["witness_triangles"], [])
        self.assertAlmostEqual(square_hodge["curl_norm"], 0.0, places=9)
        self.assertGreater(square_hodge["harmonic_norm"], 0.1)
        self.assertAlmostEqual(square_hodge["legibility_ratio"], 1.0, places=9)
        for edge in square_hodge["edges"]:
            self.assertFalse(edge["bridge"])
            self.assertAlmostEqual(edge["effective_resistance"], 3 / 4, places=9)
            self.assertAlmostEqual(edge["cycle_sensitivity"], 1 / 2, places=9)
            self.assertAlmostEqual(edge["curl_leverage"], 0.0, places=9)
            self.assertAlmostEqual(edge["harmonic_leverage"], 1 / 4, places=9)
            self.assertAlmostEqual(edge["legibility_ratio"], 1.0, places=9)

    def test_k4_dependent_triangle_boundaries_use_pseudoinverse(self):
        agents = ("A", "B", "C", "D")
        edges = tuple(itertools.combinations(agents, 2))
        rows = {edge: ("a", "a") for edge in edges}
        rows[("A", "B")] = ("a", "b")
        result = AUDIT.audit_document(document(agents=agents, edges=edges,
                                               table={"f": rows}), hodge=True)
        hodge = require_small_hodge(self, result)
        self.assertFalse(feasible(result))
        self.assertEqual(len(hodge["triangles"]), 4,
                         "K4 has four faces but only three independent boundaries")
        self.assertEqual(hodge["witness_triangles"],
                         [["A", "B", "C"], ["A", "B", "D"]],
                         "only faces containing the perturbed edge have nonzero curl")
        self.assertAlmostEqual(hodge["residual_norm"], 1.0, places=9)
        self.assertAlmostEqual(hodge["curl_norm"], 1.0, places=9)
        self.assertAlmostEqual(hodge["harmonic_norm"], 0.0, places=9)
        self.assertAlmostEqual(hodge["legibility_ratio"], 0.0, places=9)
        self.assertEqual([edge["edge"] for edge in hodge["edges"]],
                         [list(edge) for edge in edges])
        for edge in hodge["edges"]:
            self.assertFalse(edge["bridge"])
            self.assertAlmostEqual(edge["effective_resistance"], 1 / 2, places=9)
            self.assertAlmostEqual(edge["cycle_sensitivity"], (1 / 2) ** 0.5,
                                   places=9)
            self.assertAlmostEqual(edge["curl_leverage"], 1 / 2, places=9)
            self.assertAlmostEqual(edge["harmonic_leverage"], 0.0, places=9)
            self.assertAlmostEqual(edge["legibility_ratio"], 0.0, places=9)

    def test_default_does_not_allocate_registered_domain_dense_matrix(self):
        agents = tuple(f"agent-{i:05d}" for i in range(6000))
        values = tuple(f"value-{i:04d}" for i in range(400))
        data = document(agents=agents, edges=((agents[0], agents[-1]),),
                        facts={"f": list(values)}, table={})
        tracemalloc.start()
        try:
            result = AUDIT.audit_document(data)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertTrue(feasible(result))
        self.assertEqual(fact_result(result)["differences"], [])
        self.assertNotIn("hodge", fact_result(result),
                         "optional numerical diagnostics should remain opt-in")
        self.assertLess(peak, 12_000_000,
                        "sparse exact audit allocated memory proportional to agents x alphabet")

    def test_cli_is_deterministic_and_loud_on_invalid_input(self):
        edges = (("A", "B"), ("B", "C"))
        rows = {edges[0]: ("a", "b"), edges[1]: ("a", "b")}
        valid = document(edges=edges, table={"f": rows})
        with tempfile.TemporaryDirectory(prefix="claim-audit-test-", dir=HERE) as tmp:
            path = Path(tmp) / "input.json"
            path.write_text(json.dumps(valid), encoding="utf-8")
            cmd = [sys.executable, "-B", str(SOURCE), str(path)]
            first = subprocess.run(cmd, text=True, capture_output=True, check=False)
            second = subprocess.run(cmd, text=True, capture_output=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual((first.stdout, first.stderr),
                             (second.stdout, second.stderr))
            self.assertEqual(json.loads(first.stdout), AUDIT.audit_document(valid))
            path.write_text(json.dumps({"snapshot": "revision-1"}), encoding="utf-8")
            invalid = subprocess.run(cmd, text=True, capture_output=True, check=False)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertEqual(invalid.stdout, "", "invalid input cannot emit success JSON")
            duplicate_key_json = (b'{"snapshot":"revision-1",'
                                  + json.dumps(valid).encode("utf-8")[1:])
            path.write_bytes(duplicate_key_json)
            duplicate = subprocess.run(cmd, text=True, capture_output=True, check=False)
            self.assertNotEqual(duplicate.returncode, 0,
                                "duplicate JSON object keys must not silently overwrite")
            self.assertEqual(duplicate.stdout, "")
            path.write_bytes(json.dumps(valid).encode("utf-8") + b" " * (16 * 1024 * 1024))
            oversized = subprocess.run(cmd, text=True, capture_output=True, check=False)
            self.assertNotEqual(oversized.returncode, 0,
                                "CLI must reject bytes beyond the 16 MiB input cap")
            self.assertEqual(oversized.stdout, "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
