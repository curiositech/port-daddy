"""Independent arithmetic for the Book's canary operating-curve example."""
from decimal import Decimal, localcontext
from math import comb
from pathlib import Path
import unittest


class CanaryWorkedNumbers(unittest.TestCase):
    def test_binomial_and_exact_are_distinct(self):
        with localcontext() as context:
            context.prec = 40
            approximate = 1 - Decimal("0.992") ** 100
            # Sample 100 spans without replacement from 10,000, with 100 canaries.
            denominator = Decimal(comb(10_000, 100))
            miss = sum(Decimal(comb(100, k) * comb(9900, 100-k)) /
                       denominator * Decimal("0.2") ** k for k in range(101))
            exact = 1 - miss
            self.assertEqual(approximate.quantize(Decimal(".001")), Decimal(".552"))
            self.assertEqual(exact.quantize(Decimal(".001")), Decimal(".554"))
            self.assertLess(approximate, exact)
            # k counts canaries, not all leaked spans m.
            self.assertEqual(1 - Decimal(".2") ** 3, Decimal(".992"))

    def test_active_example_uses_correct_rounded_value(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / "website-v2/public/whitepaper/sealed-harbor.tex").read_text()
        self.assertIn(r"1-0.992^{100}\approx0.552", source)
        self.assertNotIn(r"1-0.992^{100}=0.553", source)


if __name__ == "__main__":
    unittest.main()
