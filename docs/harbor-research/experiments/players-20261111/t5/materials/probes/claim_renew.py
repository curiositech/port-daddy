import unittest

from harborledger.bonds import BondBook
from harborledger.claims import ClaimBook, ClaimError
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_no_renewal_at_the_deadline(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        with self.assertRaises(ClaimError):
            claims.renew(claim.claim_id, "heron", now=5, ttl=10)
        self.assertEqual(claims.expire(now=5), [claim.claim_id])
