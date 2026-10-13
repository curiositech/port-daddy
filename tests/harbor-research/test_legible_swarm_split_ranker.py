#!/usr/bin/env python3
"""Certify the synthetic rank example without importing the local runtime.

The figure's tuples are the data source, not simulated measurements. Check
their crossing claim and, independently, optimal prefixes of every possible
shared order. The small exhaustive case includes weak orders with ties.
"""
from itertools import combinations, permutations, product
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
FIGURE = ROOT / "whitepaper/figures/legible-swarm-split-ranker.tex"
CHAPTER = ROOT / "whitepaper/legible-swarm.tex"


def strict_reversals(left, right):
    """An endpoint tie (product zero) is not a crossing certificate."""
    return {
        pair for pair in combinations(sorted(left), 2)
        if (left[pair[0]] - left[pair[1]])
        * (right[pair[0]] - right[pair[1]]) < 0
    }


def common_optimal_orders(left, right):
    """Independently enumerate orders whose every prefix is optimal for both.

    Smaller ranks are preferred. Equal ranks allow any equally good subset;
    minimizing their sum is only a way to check top-m membership, not a claim
    that ordinal rank differences measure utility.
    """
    accepted = []
    for order in permutations(left):
        if all(
            sum(ranks[item] for item in order[:m])
            == sum(sorted(ranks.values())[:m])
            for ranks in (left, right)
            for m in range(1, len(order) + 1)
        ):
            accepted.append(order)
    return accepted


class MayaSlopegraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FIGURE.read_text()
        cls.rows = re.findall(
            r"^\s*([a-z-]+\.ts)/(\d+)/(\d+)/(\d+)/",
            cls.source, re.MULTILINE,
        )
        cls.route, cls.agree, cls.dispute = (
            {row[0]: int(row[index]) for row in cls.rows}
            for index in (1, 2, 3)
        )

    def test_real_artifact_names_and_explicit_synthetic_status(self):
        self.assertEqual(
            set(self.route),
            {"briefing.ts", "attention.ts", "resurrection.ts"},
        )
        self.assertEqual(len(self.rows), 3)
        for artifact in self.route:
            self.assertTrue((ROOT / "lib" / artifact).is_file(), artifact)
        self.assertIn("Synthetic ordinal ranks; 1 is highest on both sides", self.source)
        self.assertIn("[internal, synthetic ordinal example]", self.source)

    def test_complete_ordinal_scales(self):
        for ranks in (self.route, self.agree, self.dispute):
            self.assertEqual(sorted(ranks.values()), [1, 2, 3])

    def test_agreement_has_no_crossing_and_one_common_order(self):
        self.assertEqual(strict_reversals(self.route, self.agree), set())
        self.assertEqual(
            common_optimal_orders(self.route, self.agree),
            [("briefing.ts", "attention.ts", "resurrection.ts")],
        )

    def test_dispute_has_exactly_the_named_crossing_and_no_shared_order(self):
        self.assertEqual(
            strict_reversals(self.route, self.dispute),
            {("attention.ts", "briefing.ts")},
        )
        self.assertEqual(common_optimal_orders(self.route, self.dispute), [])
        self.assertEqual(min(self.route, key=self.route.get), "briefing.ts")
        self.assertEqual(min(self.dispute, key=self.dispute.get), "attention.ts")
        self.assertEqual(self.dispute["resurrection.ts"], 3)

    def test_a_tie_does_not_prove_conflict(self):
        indifferent = {"briefing.ts": 1, "attention.ts": 1, "resurrection.ts": 3}
        self.assertEqual(strict_reversals(self.route, indifferent), set())
        self.assertTrue(common_optimal_orders(self.route, indifferent))

    def test_characterization_for_all_three_item_weak_orders(self):
        assignments = [
            dict(zip(("A", "B", "C"), ranks))
            for ranks in product((1, 2, 3), repeat=3)
        ]
        for left, right in product(assignments, repeat=2):
            with self.subTest(left=left, right=right):
                self.assertEqual(
                    bool(common_optimal_orders(left, right)),
                    not strict_reversals(left, right),
                )

    def test_single_placement_before_the_characterization(self):
        chapter = CHAPTER.read_text()
        placement = r"\input{figures/legible-swarm-split-ranker}"
        self.assertEqual(chapter.count(placement), 1)
        self.assertLess(chapter.index(placement), chapter.index(r"\label{thm:comonotone}"))
        # A local font override would miss the shared Swiss serif migration.
        self.assertNotRegex(self.source, r"font\s*=|\\(?:rmfamily|sffamily|fontsize)")


if __name__ == "__main__":
    unittest.main()
