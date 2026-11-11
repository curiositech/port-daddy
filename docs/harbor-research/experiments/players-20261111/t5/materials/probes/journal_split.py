import unittest

from harborledger.audits import FAIL, AuditBook
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_the_journal_names_each_part_correctly(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        audits = AuditBook(bonds, claims, journal, "seed-1", 10000)
        claim = claims.open("heron", "task-1", 400, now=0, ttl=10)
        claims.complete(claim.claim_id, "heron", now=1)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", FAIL)
        audits.settle(claim.claim_id)
        payload = journal.entries("audit.settle")[0]["payload"]
        self.assertEqual(payload["bounty"], audits.paid["finch"])
        self.assertEqual(payload["pool"], audits.pool)
        self.assertEqual((payload["bounty"], payload["pool"]), (80, 320))
