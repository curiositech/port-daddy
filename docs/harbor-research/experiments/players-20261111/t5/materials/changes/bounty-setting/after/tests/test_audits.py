import unittest

from harborledger.audits import FAIL, PASS, AuditBook, AuditError, draw, selected
from harborledger.bonds import BondBook
from harborledger.claims import FORFEITED, IN_AUDIT, SETTLED, ClaimBook
from harborledger.journal import Journal


def make_ledger(rate_bps, seed="seed-1", **settings):
    bonds = BondBook()
    bonds.post("heron", 1000)
    bonds.post("finch", 1000)
    journal = Journal()
    claims = ClaimBook(bonds, journal)
    audits = AuditBook(bonds, claims, journal, seed, rate_bps, **settings)
    return bonds, journal, claims, audits


def done_claim(claims, stake=400, agent="heron", task="task-1"):
    claim = claims.open(agent, task, stake, now=0, ttl=10)
    claims.complete(claim.claim_id, agent, now=1)
    return claim


class TestDraw(unittest.TestCase):
    def test_draw_is_fixed_by_seed_and_claim(self):
        self.assertEqual(draw("s", 7), draw("s", 7))
        self.assertTrue(all(0 <= draw("s", n) < 10000 for n in range(200)))
        self.assertGreater(len({draw("s", n) for n in range(200)}), 150)

    def test_rate_bounds(self):
        self.assertTrue(all(selected("s", n, 10000) for n in range(50)))
        self.assertFalse(any(selected("s", n, 0) for n in range(50)))
        for bad in (-1, 10001, 0.5):
            with self.assertRaises(AuditError):
                selected("s", 1, bad)

    def test_a_bad_rate_is_refused_when_the_book_is_made(self):
        with self.assertRaises(AuditError):
            make_ledger(10001)


class TestAudits(unittest.TestCase):
    def test_a_claim_the_draw_passes_over_gets_its_stake_back(self):
        bonds, _, claims, audits = make_ledger(0)
        claim = done_claim(claims)
        self.assertEqual(audits.close(claim.claim_id), SETTLED)
        self.assertEqual((claim.state, bonds.get("heron").held), (SETTLED, 0))

    def test_close_needs_a_completed_claim(self):
        _, _, claims, audits = make_ledger(0)
        claim = claims.open("heron", "task-1", 400, now=0, ttl=10)
        with self.assertRaises(AuditError):
            audits.close(claim.claim_id)

    def test_a_drawn_claim_stays_held_until_settled(self):
        bonds, _, claims, audits = make_ledger(10000)
        claim = done_claim(claims)
        self.assertEqual(audits.close(claim.claim_id), IN_AUDIT)
        self.assertEqual(bonds.get("heron").held, 400)

    def test_a_passed_audit_returns_the_stake(self):
        bonds, _, claims, audits = make_ledger(10000)
        claim = done_claim(claims)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", PASS)
        self.assertEqual(audits.settle(claim.claim_id), 0)
        self.assertEqual((claim.state, bonds.get("heron").available()), (SETTLED, 1000))

    def test_a_failed_audit_slashes_and_pays_the_bounty(self):
        bonds, journal, claims, audits = make_ledger(10000)
        claim = done_claim(claims, stake=400)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", FAIL)
        self.assertEqual(audits.settle(claim.claim_id), 400)
        self.assertEqual((claim.state, bonds.get("heron").slashed), (FORFEITED, 400))
        self.assertEqual((audits.paid["finch"], audits.pool), (80, 320))
        self.assertEqual(journal.verify(), 0)

    def test_no_agent_audits_its_own_claim(self):
        _, _, claims, audits = make_ledger(10000)
        claim = done_claim(claims)
        audits.close(claim.claim_id)
        with self.assertRaises(AuditError):
            audits.record(claim.claim_id, "heron", PASS)

    def test_one_verdict_per_audit(self):
        _, _, claims, audits = make_ledger(10000)
        claim = done_claim(claims)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", PASS)
        with self.assertRaises(AuditError):
            audits.record(claim.claim_id, "finch", FAIL)

    def test_settle_needs_a_verdict_and_happens_once(self):
        _, _, claims, audits = make_ledger(10000)
        claim = done_claim(claims)
        audits.close(claim.claim_id)
        with self.assertRaises(AuditError):
            audits.settle(claim.claim_id)
        audits.record(claim.claim_id, "finch", FAIL)
        audits.settle(claim.claim_id)
        with self.assertRaises(AuditError):
            audits.settle(claim.claim_id)

    def test_split_adds_up(self):
        _, _, claims, audits = make_ledger(10000, bounty_bps=2500)
        claim = done_claim(claims, stake=1000)
        audits.close(claim.claim_id)
        audits.record(claim.claim_id, "finch", FAIL)
        self.assertEqual(audits.settle(claim.claim_id), 1000)
        self.assertEqual((audits.paid["finch"], audits.pool), (250, 750))
        self.assertEqual(audits.paid["finch"] + audits.pool, 1000)

    def test_a_bad_bounty_share_is_refused(self):
        with self.assertRaises(AuditError):
            make_ledger(10000, bounty_bps=10001)


if __name__ == "__main__":
    unittest.main()
