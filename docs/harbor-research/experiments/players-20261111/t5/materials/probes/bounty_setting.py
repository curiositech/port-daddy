import unittest

from harborledger.audits import FAIL, AuditBook
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_the_parts_add_up_for_an_awkward_amount(self):
        for stake in (999, 401, 7):
            bonds, journal = BondBook(), Journal()
            bonds.post("heron", 1000)
            claims = ClaimBook(bonds, journal)
            audits = AuditBook(bonds, claims, journal, "seed-1", 10000)
            claim = claims.open("heron", "task-1", stake, now=0, ttl=10)
            claims.complete(claim.claim_id, "heron", now=1)
            audits.close(claim.claim_id)
            audits.record(claim.claim_id, "finch", FAIL)
            self.assertEqual(audits.settle(claim.claim_id), stake)
            self.assertEqual(audits.paid["finch"] + audits.pool, stake)
