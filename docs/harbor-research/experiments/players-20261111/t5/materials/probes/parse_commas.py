import unittest

from harborledger.money import parse_amount


class Probe(unittest.TestCase):
    def test_parse_amount_is_exact(self):
        self.assertEqual(parse_amount("0.29"), 29)
        self.assertEqual(parse_amount("1.15"), 115)
        self.assertEqual(parse_amount("19.99"), 1999)
        self.assertEqual(parse_amount("1,019.99"), 101999)
