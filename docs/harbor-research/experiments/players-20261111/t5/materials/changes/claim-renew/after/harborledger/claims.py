"""Claims: an agent reserves a task and stakes part of its bond on it (R5, R6)."""

from dataclasses import dataclass

from .money import require_cents

OPEN = "open"            # the agent is working on the task
RELEASED = "released"    # the agent gave the task up; the stake is back
EXPIRED = "expired"      # the deadline came; the stake is back
DONE = "done"            # the agent reports the work finished; the stake stays held
IN_AUDIT = "in_audit"    # an audit was drawn; the stake stays held
SETTLED = "settled"      # closed without a slash; the stake is back
FORFEITED = "forfeited"  # closed by a failed audit; the stake was slashed


class ClaimError(Exception):
    """A claim operation that the rules do not allow."""


@dataclass
class Claim:
    claim_id: int
    agent: str
    task: str
    stake: int
    opened_at: int
    ttl: int
    state: str = OPEN

    def deadline(self):
        return self.opened_at + self.ttl


class ClaimBook:
    def __init__(self, bonds, journal):
        self._bonds = bonds
        self._journal = journal
        self._claims = {}

    def get(self, claim_id):
        try:
            return self._claims[claim_id]
        except KeyError:
            raise ClaimError(f"no claim {claim_id}") from None

    def holder(self, task):
        """The open claim on task, or None (R5)."""
        for claim in self._claims.values():
            if claim.task == task and claim.state == OPEN:
                return claim
        return None

    def open(self, agent, task, stake, now, ttl):
        """Open a claim on task and hold the stake from the agent's bond."""
        require_cents(stake, "stake")
        if ttl <= 0:
            raise ClaimError("ttl must be positive")
        if self.holder(task) is not None:
            raise ClaimError(f"task {task} already has an open claim")
        self._bonds.get(agent).hold(stake)
        claim = Claim(len(self._claims) + 1, agent, task, stake, now, ttl)
        self._claims[claim.claim_id] = claim
        self._journal.append("claim.open", {"claim": claim.claim_id, "agent": agent, "task": task,
                                            "stake": stake, "at": now, "ttl": ttl})
        return claim

    def _owned_open(self, claim_id, agent):
        claim = self.get(claim_id)
        if claim.agent != agent:
            raise ClaimError(f"claim {claim_id} belongs to {claim.agent}, not {agent}")
        if claim.state != OPEN:
            raise ClaimError(f"claim {claim_id} is {claim.state}, not open")
        return claim

    def release(self, claim_id, agent):
        """The holder gives the task up and gets the stake back."""
        claim = self._owned_open(claim_id, agent)
        self._bonds.get(agent).release(claim.stake)
        claim.state = RELEASED
        self._journal.append("claim.release", {"claim": claim_id})

    def complete(self, claim_id, agent, now):
        """The holder reports the work finished. The stake stays held (R7)."""
        claim = self._owned_open(claim_id, agent)
        if now >= claim.deadline():
            raise ClaimError(f"claim {claim_id} is past its deadline")
        claim.state = DONE
        self._journal.append("claim.done", {"claim": claim_id, "at": now})

    def renew(self, claim_id, agent, now, ttl):
        """The holder asks for more time: the deadline becomes now + ttl."""
        claim = self._owned_open(claim_id, agent)
        if ttl <= 0:
            raise ClaimError("ttl must be positive")
        if now > claim.deadline():
            raise ClaimError(f"claim {claim_id} is past its deadline")
        claim.ttl = now - claim.opened_at + ttl
        self._journal.append("claim.renew", {"claim": claim_id, "at": now, "ttl": ttl})

    def expire(self, now):
        """Expire every open claim whose deadline has come (R6). Returns their ids."""
        expired = []
        for claim in self._claims.values():
            if claim.state == OPEN and now >= claim.deadline():
                self._bonds.get(claim.agent).release(claim.stake)
                claim.state = EXPIRED
                self._journal.append("claim.expire", {"claim": claim.claim_id, "at": now})
                expired.append(claim.claim_id)
        return expired
