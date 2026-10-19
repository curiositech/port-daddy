"""Independent fixture identities for the exact typed 2-complex study."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from fractions import Fraction as F

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sheaf_2complex_study.py"
spec = importlib.util.spec_from_file_location("sheaf_2complex_study", SCRIPT)
assert spec and spec.loader
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class Sheaf2ComplexTest(unittest.TestCase):
    def setUp(self):
        self.a, self.b = study.build_complex()
        _, self.b_filled = study.build_complex(add_handoff_face=True)

    def test_typed_coboundaries_and_chain_law(self):
        self.assertEqual(self.a, study.matrix((
            (-1, 0, 1, 0, 0, 0, 0, 0),
            (0, 0, -1, 0, 1, 0, 0, 0),
            (-1, 0, 0, 0, 1, 0, 0, 0),
            (0, -1, 0, 0, 0, 1, 0, 0),
            (0, 0, 0, 0, 0, -1, 0, 1),
            (0, -1, 0, 0, 0, 0, 0, 1),
        )))
        self.assertEqual(self.b, study.matrix(((1, 1, -1, 0, 0, 0),)))
        self.assertEqual(self.b_filled[1], study.matrix(((0, 0, 0, 1, 1, -1),))[0])
        for b in (self.b, self.b_filled):
            for col in range(8):
                self.assertEqual(study.matvec(b, tuple(row[col] for row in self.a)),
                                 (F(0),) * len(b))

    def test_betti_numbers_and_exact_orthogonal_decomposition(self):
        self.assertEqual(study.rank(self.a), 4)
        self.assertEqual(study.rank(self.b), 1)
        self.assertEqual(study.rank(self.b_filled), 2)
        self.assertEqual((8 - study.rank(self.a), 6 - study.rank(self.a) - study.rank(self.b),
                          1 - study.rank(self.b)), (4, 1, 0))
        self.assertEqual((8 - study.rank(self.a), 6 - study.rank(self.a) - study.rank(self.b_filled),
                          2 - study.rank(self.b_filled)), (4, 0, 0))
        for vector in ((1, 1, -1, 0, 0, 0), (0, 0, 0, 1, 1, -1),
                       (1, 0, 1, 0, 0, 0), (2, 1, 0, 1, 1, -1),
                       (F(1, 3), 0, F(-2, 5), F(1, 7), 1, -2)):
            y = tuple(map(F, vector))
            for b in (self.b, self.b_filled):
                parts = study.hodge(self.a, b, y)
                self.assertEqual(study.add(study.add(parts["gradient"], parts["coexact"]),
                                           parts["harmonic"]), y)
                self.assertEqual(study.matvec(b, parts["harmonic"]), (F(0),) * len(b))
                self.assertEqual(study.matvec(study.transpose(self.a), parts["harmonic"]),
                                 (F(0),) * 8)
                self.assertEqual(study.dot(parts["gradient"], parts["coexact"]), 0)

    def test_fault_signatures_and_unchanged_total_detection(self):
        cases = {
            "local_count": ((1, 1, -1, 0, 0, 0), (0, 3, 0, 3), (0, 3, 0, 3)),
            "global_handoff": ((0, 0, 0, 1, 1, -1), (0, 0, 3, 3), (0, 3, 0, 3)),
            "gradient_alias_difference": ((1, 0, 1, 0, 0, 0), (2, 0, 0, 0), (2, 0, 0, 0)),
            "mixed": ((2, 1, 0, 1, 1, -1), (2, 3, 3, 6), (2, 6, 0, 6)),
        }
        keys = ("gradient_norm_squared", "coexact_norm_squared",
                "harmonic_norm_squared", "residual_norm_squared")
        for name, (raw, base_expected, filled_expected) in cases.items():
            y = tuple(map(F, raw))
            base = study.hodge(self.a, self.b, y)
            filled = study.hodge(self.a, self.b_filled, y)
            self.assertEqual(tuple(base[key] for key in keys), tuple(map(F, base_expected)), name)
            self.assertEqual(tuple(filled[key] for key in keys), tuple(map(F, filled_expected)), name)
            self.assertEqual(base["compatibility_residual"], filled["compatibility_residual"])
        self.assertEqual(study.matvec(self.b, tuple(map(F, cases["global_handoff"][0]))), (F(0),))
        self.assertEqual(study.matvec(self.b_filled, tuple(map(F, cases["global_handoff"][0]))),
                         (F(0), F(3)))

    def test_malformed_restriction_rejected(self):
        with self.assertRaisesRegex(ValueError, "malformed restriction"):
            study.build_complex(restriction_overrides={("02", "source"): ((1, 0),)})
        with self.assertRaisesRegex(ValueError, "violate"):
            study.build_complex(restriction_overrides={("02", "source"): ((0, 1), (0, 1))})

    def test_edge_group_distance_and_sparse_alias(self):
        distance, _, _, witness = study.sheaf_code_distance(self.a)
        self.assertEqual(distance, 2)
        self.assertEqual(sum(any(witness[i] for i in group) for group in study.EDGE_GROUPS), 2)
        left = (F(1), F(0), F(0), F(0), F(0), F(0))
        right = (F(0), F(0), F(-1), F(0), F(0), F(0))
        self.assertEqual(study.sub(left, right), (F(1), F(0), F(1), F(0), F(0), F(0)))
        self.assertEqual(study.hodge(self.a, self.b, left)["compatibility_residual"],
                         study.hodge(self.a, self.b, right)["compatibility_residual"])
        self.assertEqual(study.matvec(self.b, left), study.matvec(self.b, right))
        for group in study.EDGE_GROUPS:
            supported_rows = tuple(self.a[i] for i in range(6) if i not in group)
            self.assertEqual(study.rank(supported_rows, 8), 4)

    def test_relative_visible_cocycle_connecting_map(self):
        result = study.relative_coverage(self.a, self.b)
        self.assertEqual((result["h0_k"], result["h0_l"], result["restriction_rank"],
                          result["h1_relative"], result["connecting_rank"]), (4, 4, 3, 2, 1))
        self.assertEqual(result["locally_compatible_nonextendible_handoff"],
                         (F(0), F(1), F(-1), F(0)))
        self.assertTrue(result["nonextendible_detected"])
        self.assertTrue(result["equal_handoff_extendible"])
        self.assertEqual(result["equal_handoff_connecting_cochain"],
                         (F(0), F(0), F(-1), F(-1)))

    def test_cli_machine_and_paper_formats(self):
        raw = subprocess.check_output([sys.executable, str(SCRIPT), "--format", "json"], text=True)
        result = json.loads(raw)
        self.assertEqual(result["base"], {"rank_d0": 4, "rank_d1": 1, "h0": 4, "h1": 1, "h2": 0})
        self.assertIn("synthetic", result["provenance"])
        page = subprocess.check_output([sys.executable, str(SCRIPT), "--format", "markdown"], text=True)
        self.assertIn("| global_handoff | base | 0 | 0 | 3 | 3 | 0 |", page)
        self.assertIn("does not establish hidden truth", page)


if __name__ == "__main__":
    unittest.main()
