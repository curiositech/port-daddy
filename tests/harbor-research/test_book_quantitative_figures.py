"""Independent arithmetic and source-geometry guards; not visual approval."""
from fractions import Fraction as Q
from itertools import combinations
from math import comb, log2
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


def floor_bits(n, k, m):
    if not 0 <= k <= m <= n:
        raise ValueError("require 0 <= k <= m <= n")
    return log2(comb(n, k)) - log2(comb(m, k))


def polygon_area(points):
    pairs = zip(points, points[1:] + points[:1])
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in pairs)) / 2


def check_wedge_source(source):
    match = re.search(r"\\path\[fill=pdamber!18,draw=none\](.*?)-- cycle;", source, re.S)
    assert match, "explicit unstroked refusal polygon required"
    points = [(Q(x), Q(y)) for x, y in re.findall(
        r"axis cs:([\d.]+),([\d.]+)", match.group(1))]
    assert points == [(0, 0), (90, 90), (90, Q("67.5")), (Q("22.5"), 0)]
    assert polygon_area(points) / 90**2 == Q(7, 32)
    for label in ("(cr)", "$7/32$ of all draws", "illustrative prior, not market data"):
        assert label in source, label
    assert "domain=22.5:90,samples=2] {x-22.5}" in source


class QuantitativeFigureChecks(unittest.TestCase):
    def test_succession_wait_and_distinct_offscale_crossings(self):
        floor = Q(8,3)
        for mu in (Q(61,20), Q(7,2), Q(5), Q(8), Q(12)):
            effective = mu*Q(1,4)/(Q(1,2)+Q(1,4))
            correct = (1+mu*Q(1,2)/(Q(1,2)+Q(1,4))**2)/(effective-1)
            naive = 1/(effective-1) + floor
            self.assertEqual(correct, floor+11/(mu-3))
            self.assertEqual(naive, floor+3/(mu-3))
            self.assertGreater(correct, naive)
            self.assertGreater(naive, floor)
        self.assertEqual(floor+Q(11,5-3), Q(49,6))
        self.assertEqual(floor+Q(3,5-3), Q(25,6))
        self.assertGreater(floor, Q("1.0362"))
        self.assertNotEqual(3+11/(256-floor), 3+3/(256-floor))
        # Reject the first candidate's assertion that all omitted values are
        # above the panel: both are below 256 at this omitted stable input.
        for numerator in (11,3):
            self.assertLess(floor+numerator/(Q("3.049")-3), 256)
        source = (ROOT / "website-v2/public/whitepaper/figures/fig-he-succession-price.tex").read_text()
        for required in ("domain=3.05:12", "ymode=log", "h; log scale",
                         "tasks/h", "not measurements", "8/3+11/(x-3)",
                         "8/3+3/(x-3)", "3.05\\le\\mu_s\\le12"):
            self.assertIn(required, source)
        self.assertNotIn("min(", source)
        chapter = (ROOT / "website-v2/public/whitepaper/harbor-economy.tex").read_text()
        self.assertNotIn("distance between the threshold and the canary", chapter)

    def test_digest_floor_values(self):
        one = floor_bits(60, 2, 8)
        joint = floor_bits(60, 4, 8)
        self.assertAlmostEqual(one, 5.982179, places=6)
        self.assertAlmostEqual(2 * one, 11.964357, places=6)
        self.assertAlmostEqual(joint, 12.766159, places=6)
        self.assertAlmostEqual(joint / (2 * one), 1.067016, places=6)
        self.assertNotAlmostEqual(joint / one, joint / (2 * one), places=2)

    def test_exact_specialized_curves_and_domain(self):
        source = (ROOT / "whitepaper/figures/legible-swarm-readpoverty.tex").read_text()
        self.assertIn("ln(\\n*(\\n-1)/56)/ln(2)", source)
        self.assertIn("ln(\\n*(\\n-1)*(\\n-2)*(\\n-3)/1680)/ln(2)", source)
        self.assertIn("domain=16:100,samples=85,smooth=false", source)
        self.assertIn("$k{=}2$, $m{=}8$", source)
        self.assertIn("not achieved implementation costs", source)
        self.assertIn("may each open eight items", source)
        self.assertIn("eight total", source)
        for n in range(16, 101):
            self.assertAlmostEqual(floor_bits(n, 2, 8), log2(n*(n-1)/56), places=11)
            self.assertAlmostEqual(floor_bits(n, 4, 8), log2(n*(n-1)*(n-2)*(n-3)/1680), places=11)
        self.assertEqual(floor_bits(8, 4, 8), 0)
        with self.assertRaises(ValueError):
            floor_bits(8, 9, 8)

    def test_wedge_geometry_and_denominators(self):
        source = (ROOT / "website-v2/public/whitepaper/figures/fig-he-ms-wedge.tex").read_text()
        check_wedge_source(source)
        a, m = Q(90, 4), Q(90)
        all_draws = a * (2*m-a) / (2*m*m)
        efficient_share = all_draws / Q(1, 2)
        lost_gains = (m*a*a/2 - a*a*a/3) / m**2
        self.assertEqual(all_draws, Q(7, 32))
        self.assertEqual(efficient_share, Q(7, 16))
        self.assertEqual(lost_gains / (m/6), Q(5, 32))
        self.assertTrue(0 < 70-60 < a)
        for bad in (source.replace("90,67.5", "90,70"),
                    source.replace("$7/32$ of all draws", "$7/16$ of all draws")):
            with self.assertRaises(AssertionError):
                check_wedge_source(bad)

    def test_regret_threshold_exact_grid_and_zero_loss_case(self):
        for miss in (0, 1, 10, 100):
            for attention in (0, 1, 10, 101):
                for false_alarm in (0, 1, 5, 100):
                    for numerator in range(101):
                        posterior = Q(numerator, 100)
                        original = miss*posterior >= attention + false_alarm*(1-posterior)
                        if miss + false_alarm:
                            corrected = posterior >= Q(attention+false_alarm, miss+false_alarm)
                        else:
                            corrected = attention == 0
                        self.assertEqual(original, corrected)

    def test_wrong_odds_form_is_rejected_by_counterexample(self):
        posterior = Q(14, 100)
        self.assertLess(100*posterior, 10+5*(1-posterior))
        self.assertGreaterEqual(posterior/(1-posterior), Q(15, 100))
        self.assertLess(posterior/(1-posterior), Q(15, 90))
        source = (ROOT / "whitepaper/legible-swarm.tex").read_text()
        statement = source.split(r"\label{thm:regret-head}", 1)[1].split(r"\end{pdclaim}", 1)[0]
        self.assertIn(r"{C_{\mathrm{miss}}(x)+C_{\mathrm{fa}}}", statement)
        self.assertNotIn(r"\frac{a(x)}{1-a(x)}", statement)
        self.assertIn("both loss terms are zero", statement)

    def test_split_penalty_coordinates_and_exact_positivity(self):
        source = (ROOT / "whitepaper/figures/legible-swarm-split-penalty.tex").read_text()
        blocks = re.findall(r"coordinates \{([^}]+)\}", source)
        self.assertEqual(len(blocks), 2)
        for block, m in zip(blocks, (8, 20)):
            points = [(int(k), float(r)) for k, r in re.findall(r"\((\d+),([\d.]+)\)", block)]
            self.assertEqual([k for k, _ in points], list(range(1, m//2+1)))
            for k, r in points:
                self.assertAlmostEqual(r, floor_bits(60, 2*k, m)/(2*floor_bits(60, k, m)), places=6)
        for n in range(3, 81):
            for m in range(2, n):
                for k in range(1, m//2+1):
                    self.assertGreater(comb(n, 2*k)*comb(m, k)**2,
                                       comb(m, 2*k)*comb(n, k)**2)
        for k in (1, 2, 10, 100, 1000):
            n, m = 2*k+1, 2*k
            self.assertEqual(Q(comb(n, 2*k), comb(m, 2*k)), 2*k+1)
            self.assertEqual(Q(comb(n, k), comb(m, k)), Q(2*k+1, k+1))

    def test_counting_ceiling_is_not_necessarily_attainable(self):
        # N=4,k=2,m=3: two messages meet the elementary counting bound,
        # but every pair of distinct review triples shares one critical pair.
        reviews = list(combinations(range(4), 3))
        coverage = [set(combinations(review, 2)) for review in reviews]
        self.assertEqual(2*comb(3, 2), comb(4, 2))
        self.assertEqual(max(len(a | b) for a, b in combinations(coverage, 2)), 5)
        self.assertEqual(max(len(a | b | c) for a, b, c in combinations(coverage, 3)), 6)


if __name__ == "__main__":
    unittest.main()
