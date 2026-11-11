import unittest

from harborledger.money import MoneyError, format_amount, parse_amount, require_cents, share, split


class TestMoney(unittest.TestCase):
    def test_require_cents_accepts_whole_amounts(self):
        self.assertEqual(require_cents(0), 0)
        self.assertEqual(require_cents(1250), 1250)

    def test_require_cents_refuses_floats_bools_and_negatives(self):
        for bad in (12.5, True, -1, "12"):
            with self.assertRaises(MoneyError):
                require_cents(bad)

    def test_parse_amount(self):
        self.assertEqual(parse_amount("12.50"), 1250)
        self.assertEqual(parse_amount("12"), 1200)
        self.assertEqual(parse_amount(" 3.5 "), 350)
        self.assertEqual(parse_amount("0.05"), 5)

    def test_parse_amount_refuses_bad_text(self):
        for bad in ("", "abc", "1.234", "-5", "1.2.3"):
            with self.assertRaises(MoneyError):
                parse_amount(bad)

    def test_format_amount(self):
        self.assertEqual(format_amount(1250), "12.50")
        self.assertEqual(format_amount(5), "0.05")
        self.assertEqual(format_amount(0), "0.00")

    def test_share_rounds_down(self):
        self.assertEqual(share(1000, 2000), 200)
        self.assertEqual(share(999, 2000), 199)
        self.assertEqual(share(1, 9999), 0)
        self.assertEqual(share(777, 10000), 777)

    def test_share_refuses_bad_basis_points(self):
        for bad in (-1, 10001, 0.5):
            with self.assertRaises(MoneyError):
                share(100, bad)

    def test_split_adds_up(self):
        self.assertEqual(split(100, 3), [34, 33, 33])
        self.assertEqual(split(7, 7), [1] * 7)
        self.assertEqual(sum(split(1001, 4)), 1001)

    def test_parse_amount_with_thousands_separators(self):
        self.assertEqual(parse_amount("1,250.50"), 125050)
        self.assertEqual(parse_amount("2,000"), 200000)
        self.assertEqual(parse_amount("1,000,000.25"), 100000025)
        for bad in ("1,25", "12,50.00", ",500", "1,,000"):
            with self.assertRaises(MoneyError):
                parse_amount(bad)


if __name__ == "__main__":
    unittest.main()
