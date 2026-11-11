import unittest

from harborledger.bonds import BondBook
from harborledger.claims import DONE, RELEASED, ClaimBook
from harborledger.journal import Journal


class Probe(unittest.TestCase):
    def test_expire_leaves_claims_that_are_not_open(self):
        bonds, journal = BondBook(), Journal()
        bonds.post("heron", 1000)
        claims = ClaimBook(bonds, journal)
        given_up = claims.open("heron", "task-1", 300, now=0, ttl=5)
        claims.release(given_up.claim_id, "heron")
        finished = claims.open("heron", "task-2", 400, now=0, ttl=5)
        claims.complete(finished.claim_id, "heron", now=2)
        self.assertEqual(claims.expire(now=9), [])
        self.assertEqual((given_up.state, finished.state), (RELEASED, DONE))
        self.assertEqual(bonds.get("heron").held, 400)
