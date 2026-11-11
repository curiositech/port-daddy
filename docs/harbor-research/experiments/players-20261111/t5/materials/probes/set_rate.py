import unittest

from harborledger.audits import AuditBook, AuditError
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_set_rate_refuses_a_rate_out_of_range(self):
        bonds, journal = BondBook(), Journal()
        audits = AuditBook(bonds, ClaimBook(bonds, journal), journal, "seed-1", 0)
        for bad in (10001, -5):
            with self.assertRaises(AuditError):
                audits.set_rate(bad)
        self.assertEqual(journal.entries("audit.rate"), [])
