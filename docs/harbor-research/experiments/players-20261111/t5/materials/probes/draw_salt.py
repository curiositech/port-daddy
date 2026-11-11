import unittest

from harborledger.audits import AuditBook
from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook
from harborledger.journal import Journal


def outcome(seed, done_at):
    bonds, journal = BondBook(), Journal()
    bonds.post("heron", 1000)
    claims = ClaimBook(bonds, journal)
    audits = AuditBook(bonds, claims, journal, seed, 5000)
    claim = claims.open("heron", "task-1", 400, now=0, ttl=10)
    claims.complete(claim.claim_id, "heron", now=done_at)
    return audits.close(claim.claim_id)


class Probe(unittest.TestCase):
    def test_the_holder_cannot_move_the_draw_by_timing(self):
        for seed in range(40):
            self.assertEqual(outcome(f"seed-{seed}", 1), outcome(f"seed-{seed}", 2))
