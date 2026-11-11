import unittest

from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_the_late_fee_is_five_percent(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        claims.open("heron", "task-1", 1000, now=0, ttl=5)
        claims.expire(now=5)
        self.assertEqual(bonds.get("heron").slashed, 50)
        self.assertEqual(bonds.get("heron").available(), 950)
        self.assertEqual(claims.late_fees, 50)
