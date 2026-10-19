"""Independent brute-force checks of minimum retained categorical certificates."""
import copy
import itertools
import unittest

from costed_claim_certificates import minimum_certificate, verify_selection


def rows_for(edges, states):
    rows = []
    for i, (edge, state) in enumerate(zip(edges, states)):
        if state is None:
            continue
        row = {"fact": "verdict", "snapshot": "revision-1", "edge": list(edge),
               "receipts": [f"{i}-forward", f"{i}-reverse"]}
        if state == "zero":
            row["kind"] = "zero"
        else:
            row.update(kind="signed", tail=state[0], head=state[1])
        rows.append(row)
    return rows


def brute_feasible(rows, values=("a", "b")):
    vertices = sorted({v for row in rows for v in row["edge"]})
    for assignment in itertools.product(values, repeat=len(vertices)):
        labels = dict(zip(vertices, assignment))
        if all((labels[row["edge"][0]] == labels[row["edge"][1]])
               if row["kind"] == "zero" else
               (labels[row["edge"][0]] == row["tail"]
                and labels[row["edge"][1]] == row["head"])
               for row in rows):
            return True
    return False


def brute_optimum(rows, costs, values=("a", "b")):
    best = None
    for mask in range(1 << len(rows)):
        subset = [row for i, row in enumerate(rows) if mask & (1 << i)]
        if not brute_feasible(subset, values):
            cost = sum(costs[tuple(row["edge"])] for row in subset)
            best = cost if best is None else min(best, cost)
    return best


class CostedCertificateTests(unittest.TestCase):
    def test_all_binary_partial_k4_tables_with_three_price_schedules(self):
        edges = list(itertools.combinations("0123", 2))
        count = 0
        for states in itertools.product((None, "zero", ("a", "b"), ("b", "a")), repeat=6):
            rows = rows_for(edges, states)
            # Only compare infeasible-subset enumeration for represented rows.
            # Includes missing edges, zero-price paths and shared pin-edge costs.
            for schedule in ((1,) * 6, (0, 1, 2, 0, 2, 1), (7, 1, 3, 2, 1, 5)):
                by_edge = dict(zip(edges, schedule))
                costs = {tuple(row["edge"]): by_edge[tuple(row["edge"])] for row in rows}
                result = minimum_certificate(rows, costs)
                self.assertEqual(result["cost"], brute_optimum(rows, costs), (states, schedule))
                self.assertEqual(result["status"] == "feasible", brute_feasible(rows))
                if result["status"] == "infeasible":
                    self.assertTrue(verify_selection(rows, costs, result))
                count += 1
        self.assertEqual(count, 12288)
        print(f"new costed-certificate oracle cases: {count}")

    def test_ternary_triangle_against_every_retained_subset(self):
        edges = list(itertools.combinations("012", 2))
        states = (None, "zero", *itertools.permutations(("a", "b", "c"), 2))
        count = 0
        for choices in itertools.product(states, repeat=3):
            rows = rows_for(edges, choices)
            costs = {tuple(row["edge"]): i + 1 for i, row in enumerate(rows)}
            result = minimum_certificate(rows, costs)
            self.assertEqual(result["cost"], brute_optimum(rows, costs, ("a", "b", "c")))
            if result["status"] == "infeasible":
                self.assertTrue(verify_selection(rows, costs, result))
            count += 1
        self.assertEqual(count, 512)
        print(f"new ternary certificate oracle cases: {count}")

    def test_one_nonzero_edge_supplies_both_pins_and_is_charged_once(self):
        rows = rows_for([("0", "1"), ("0", "2"), ("1", "2")],
                        [("a", "b"), "zero", "zero"])
        costs = {("0", "1"): 7, ("0", "2"): 1, ("1", "2"): 2}
        result = minimum_certificate(rows, costs)
        self.assertEqual(result["cost"], 10)
        self.assertEqual(result["pins"][0]["edge_index"], result["pins"][1]["edge_index"])
        self.assertTrue(verify_selection(rows, costs, result))

    def test_pin_conflict_at_one_vertex_requires_no_zero_path(self):
        rows = rows_for([("0", "1"), ("1", "2")], [("a", "b"), ("a", "b")])
        costs = {("0", "1"): 2, ("1", "2"): 3}
        result = minimum_certificate(rows, costs)
        self.assertEqual((result["cost"], result["zero_path"]), (5, []))

    def test_verifier_rejects_tampered_pin_path_subset_or_price(self):
        rows = rows_for([("0", "1"), ("0", "2"), ("1", "2")],
                        [("a", "b"), "zero", "zero"])
        costs = {tuple(row["edge"]): 1 for row in rows}
        good = minimum_certificate(rows, costs)
        mutants = []
        bad = copy.deepcopy(good); bad["pins"][0]["value"] = "alien"; mutants.append(bad)
        bad = copy.deepcopy(good); bad["zero_path"] = []; mutants.append(bad)
        bad = copy.deepcopy(good); bad["cost"] = 0; mutants.append(bad)
        bad = copy.deepcopy(good); bad["edge_indices"] = []; mutants.append(bad)
        bad = copy.deepcopy(good); bad["pins"][0]["edge_index"] = -1; mutants.append(bad)
        bad = copy.deepcopy(good); bad["cost"] = True; mutants.append(bad)
        for bad in mutants:
            self.assertFalse(verify_selection(rows, costs, bad))

    def test_malformed_or_cross_context_observations_fail_closed(self):
        rows = rows_for([("0", "1"), ("1", "2")], [("a", "b"), ("a", "b")])
        costs = {tuple(row["edge"]): 1 for row in rows}
        for key, value in (("fact", "other"), ("snapshot", "revision-2"),
                           ("receipts", rows[0]["receipts"]), ("head", "a")):
            malformed = copy.deepcopy(rows)
            malformed[1][key] = value
            with self.assertRaises(ValueError):
                minimum_certificate(malformed, costs)
        for value in (-1, 0.5, True, float("inf")):
            with self.assertRaises(ValueError):
                minimum_certificate(rows, {**costs, ("0", "1"): value})
        with self.assertRaises(ValueError):
            minimum_certificate(rows, {})

    def test_selection_binds_fact_snapshot_receipts_and_prices(self):
        rows = rows_for([("0", "1"), ("1", "2")], [("a", "b"), ("a", "b")])
        costs = {tuple(row["edge"]): 1 for row in rows}
        result = minimum_certificate(rows, costs)
        for key, value in (("fact", "other"), ("snapshot", "revision-2")):
            replay = [{**row, key: value} for row in rows]
            self.assertFalse(verify_selection(replay, costs, result))
        replay = copy.deepcopy(rows)
        replay[0]["receipts"] = ["replacement-1", "replacement-2"]
        self.assertFalse(verify_selection(replay, costs, result))
        repriced = {edge: 2 for edge in costs}
        forged = {**result, "cost": 4}
        self.assertFalse(verify_selection(rows, repriced, forged))


if __name__ == "__main__":
    unittest.main(verbosity=2)
