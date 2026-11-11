import unittest

from harborledger.audits import FAIL, AuditBook, AuditError
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_a_settled_audit_cannot_be_reopened(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        audits = AuditBook(bonds, claims, journal, "seed-1", 10000)
        first = claims.open("heron", "task-1", 400, now=0, ttl=10)
        claims.complete(first.claim_id, "heron", now=1)
        claims.open("heron", "task-2", 400, now=0, ttl=10)
        audits.close(first.claim_id)
        audits.record(first.claim_id, "finch", FAIL)
        audits.settle(first.claim_id)
        with self.assertRaises(AuditError):
            audits.reopen(first.claim_id, "once more")
        self.assertEqual(bonds.get("heron").slashed, 400)
