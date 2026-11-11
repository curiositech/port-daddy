import unittest

from harborledger.bonds import BondBook, BondError
from harborledger.claims import DONE, EXPIRED, OPEN, RELEASED, ClaimBook, ClaimError
from harborledger.journal import Journal


def make_book():
    bonds = BondBook()
    bonds.post("heron", 1000)
    bonds.post("finch", 1000)
    journal = Journal()
    return bonds, journal, ClaimBook(bonds, journal)


class TestClaims(unittest.TestCase):
    def test_open_holds_the_stake(self):
        bonds, journal, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=10, ttl=5)
        self.assertEqual((claim.claim_id, claim.state, claim.deadline()), (1, OPEN, 15))
        self.assertEqual(bonds.get("heron").held, 400)
        self.assertEqual(journal.entries("claim.open")[0]["payload"]["stake"], 400)

    def test_a_task_has_one_open_claim(self):
        _, _, claims = make_book()
        claims.open("heron", "task-1", 100, now=0, ttl=5)
        with self.assertRaises(ClaimError):
            claims.open("finch", "task-1", 100, now=1, ttl=5)
        self.assertEqual(claims.holder("task-1").agent, "heron")

    def test_open_needs_the_stake_to_be_available(self):
        _, _, claims = make_book()
        with self.assertRaises(BondError):
            claims.open("heron", "task-1", 1001, now=0, ttl=5)
        self.assertIsNone(claims.holder("task-1"))

    def test_release_returns_the_stake_and_frees_the_task(self):
        bonds, _, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        claims.release(claim.claim_id, "heron")
        self.assertEqual((claim.state, bonds.get("heron").held), (RELEASED, 0))
        claims.open("finch", "task-1", 100, now=1, ttl=5)

    def test_only_the_holder_releases(self):
        _, _, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        with self.assertRaises(ClaimError):
            claims.release(claim.claim_id, "finch")

    def test_release_twice_raises(self):
        bonds, _, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        claims.release(claim.claim_id, "heron")
        with self.assertRaises(ClaimError):
            claims.release(claim.claim_id, "heron")
        self.assertEqual(bonds.get("heron").available(), 1000)

    def test_complete_keeps_the_stake_held(self):
        bonds, _, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        claims.complete(claim.claim_id, "heron", now=4)
        self.assertEqual((claim.state, bonds.get("heron").held), (DONE, 400))

    def test_cannot_complete_at_the_deadline(self):
        _, _, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        with self.assertRaises(ClaimError):
            claims.complete(claim.claim_id, "heron", now=5)

    def test_expire_returns_the_stake(self):
        bonds, journal, claims = make_book()
        claim = claims.open("heron", "task-1", 400, now=0, ttl=5)
        self.assertEqual(claims.expire(now=4), [])
        self.assertEqual(claims.expire(now=5), [1])
        self.assertEqual((claim.state, bonds.get("heron").available()), (EXPIRED, 1000))
        self.assertEqual(len(journal.entries("claim.expire")), 1)

    def test_expire_takes_every_claim_that_is_due(self):
        _, _, claims = make_book()
        claims.open("heron", "task-1", 100, now=0, ttl=9)
        claims.open("finch", "task-2", 100, now=0, ttl=3)
        claims.open("heron", "task-3", 100, now=0, ttl=5)
        self.assertEqual(sorted(claims.expire(now=6)), [2, 3])
        self.assertEqual(claims.holder("task-1").claim_id, 1)

    def test_open_claims_are_listed_by_deadline(self):
        _, _, claims = make_book()
        claims.open("heron", "task-1", 100, now=0, ttl=9)
        claims.open("finch", "task-2", 100, now=0, ttl=3)
        third = claims.open("heron", "task-3", 100, now=0, ttl=5)
        self.assertEqual([c.claim_id for c in claims.open_claims()], [2, 3, 1])
        self.assertEqual([c.claim_id for c in claims.open_claims("heron")], [3, 1])
        claims.release(third.claim_id, "heron")
        self.assertEqual([c.claim_id for c in claims.open_claims("heron")], [1])


if __name__ == "__main__":
    unittest.main()
