"""Audits: a seeded draw picks completed claims, and a failed audit slashes the stake (R7, R8)."""

import hashlib

from .claims import DONE, FORFEITED, IN_AUDIT, SETTLED
from .money import BPS, share

BOUNTY_BPS = 2_000  # the auditor's share of a slash
PASS = "pass"
FAIL = "fail"


class AuditError(Exception):
    """An audit operation that the rules do not allow."""


def draw(seed, claim_id):
    """A number from 0 to 9,999 fixed by the seed and the claim id alone (R7)."""
    digest = hashlib.sha256(f"{seed}:{claim_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % BPS


def selected(seed, claim_id, rate_bps):
    """Whether the draw picks this claim for audit at the given rate."""
    if isinstance(rate_bps, bool) or not isinstance(rate_bps, int) or not 0 <= rate_bps <= BPS:
        raise AuditError(f"rate must be an int from 0 to {BPS} basis points, got {rate_bps!r}")
    return draw(seed, claim_id) < rate_bps


class Audit:
    def __init__(self, claim_id):
        self.claim_id = claim_id
        self.auditor = None
        self.verdict = None
        self.settled = False


class AuditBook:
    def __init__(self, bonds, claims, journal, seed, rate_bps):
        selected(seed, 0, rate_bps)  # refuses a bad rate at once
        self._bonds = bonds
        self._claims = claims
        self._journal = journal
        self._seed = seed
        self._rate_bps = rate_bps
        self._audits = {}
        self.pool = 0    # slashed money the ledger keeps
        self.paid = {}   # auditor -> bounty earned

    def set_rate(self, rate_bps):
        """Change the audit rate for claims closed from now on."""
        if rate_bps < 0 and rate_bps > BPS:
            raise AuditError(f"rate must be from 0 to {BPS} basis points, got {rate_bps!r}")
        self._rate_bps = rate_bps
        self._journal.append("audit.rate", {"rate_bps": rate_bps})

    def close(self, claim_id):
        """Close a completed claim: open an audit if the draw picks it, else return the stake."""
        claim = self._claims.get(claim_id)
        if claim.state != DONE:
            raise AuditError(f"claim {claim_id} is {claim.state}, not done")
        if selected(self._seed, claim_id, self._rate_bps):
            claim.state = IN_AUDIT
            self._audits[claim_id] = Audit(claim_id)
            self._journal.append("audit.open", {"claim": claim_id})
            return IN_AUDIT
        self._bonds.get(claim.agent).release(claim.stake)
        claim.state = SETTLED
        self._journal.append("claim.settle", {"claim": claim_id})
        return SETTLED

    def _audit(self, claim_id):
        try:
            return self._audits[claim_id]
        except KeyError:
            raise AuditError(f"claim {claim_id} has no audit") from None

    def record(self, claim_id, auditor, verdict):
        """Record the auditor's verdict on an open audit."""
        audit = self._audit(claim_id)
        if verdict not in (PASS, FAIL):
            raise AuditError(f"verdict must be {PASS!r} or {FAIL!r}, got {verdict!r}")
        if auditor == self._claims.get(claim_id).agent:
            raise AuditError("an agent cannot audit its own claim")
        if audit.verdict is not None:
            raise AuditError(f"claim {claim_id} already has a verdict")
        audit.auditor = auditor
        audit.verdict = verdict
        self._journal.append("audit.verdict", {"claim": claim_id, "auditor": auditor, "verdict": verdict})

    def settle(self, claim_id):
        """Settle a recorded audit once (R8). Returns the amount slashed."""
        audit = self._audit(claim_id)
        if audit.verdict is None:
            raise AuditError(f"claim {claim_id} has no verdict yet")
        if audit.settled:
            raise AuditError(f"claim {claim_id} is already settled")
        claim = self._claims.get(claim_id)
        bond = self._bonds.get(claim.agent)
        taken = 0
        if audit.verdict == PASS:
            bond.release(claim.stake)
            claim.state = SETTLED
        else:
            taken = bond.slash(claim.stake)
            bounty = share(taken, BOUNTY_BPS)
            to_pool = taken - bounty
            self.paid[audit.auditor] = self.paid.get(audit.auditor, 0) + bounty
            self.pool += to_pool
            claim.state = FORFEITED
        audit.settled = True
        self._journal.append("audit.settle", {"claim": claim_id, "verdict": audit.verdict})
        return taken
