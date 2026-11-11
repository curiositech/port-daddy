"""Bonds: money an agent posts, which claims hold and failed audits slash (R3, R4)."""

from .money import require_cents


class BondError(Exception):
    """A bond operation that the rules do not allow."""


class Bond:
    def __init__(self, agent, posted=0):
        self.agent = agent
        self.posted = require_cents(posted, "posted")
        self.held = 0      # reserved by claims that are not closed yet
        self.slashed = 0   # taken for good

    def available(self):
        """Money that is posted and neither held nor slashed."""
        return self.posted - self.held - self.slashed

    def top_up(self, amount):
        """Post more money."""
        self.posted += require_cents(amount)

    def withdraw(self, amount):
        """Take back money that is available."""
        require_cents(amount)
        if amount > self.available():
            raise BondError(f"{self.agent}: cannot withdraw {amount}, available {self.available()}")
        self.posted -= amount

    def hold(self, amount):
        """Reserve available money for a claim."""
        require_cents(amount)
        if amount > self.available():
            raise BondError(f"{self.agent}: cannot hold {amount}, available {self.available()}")
        self.held += amount

    def release(self, amount):
        """Return held money to available."""
        require_cents(amount)
        if amount > self.held:
            raise BondError(f"{self.agent}: cannot release {amount}, held {self.held}")
        self.held -= amount

    def slash(self, amount):
        """Take held money for good and return the amount taken (R4)."""
        require_cents(amount)
        if amount > self.held:
            raise BondError(f"{self.agent}: cannot slash {amount}, held {self.held}")
        self.held -= amount
        self.slashed += amount
        return amount


class BondBook:
    """Every agent's bond, by agent name."""

    def __init__(self):
        self._bonds = {}

    def post(self, agent, amount):
        """Post money for agent, opening its bond if it has none. Returns the bond."""
        require_cents(amount)
        bond = self._bonds.get(agent)
        if bond is None:
            bond = self._bonds[agent] = Bond(agent)
        bond.top_up(amount)
        return bond

    def get(self, agent):
        try:
            return self._bonds[agent]
        except KeyError:
            raise BondError(f"{agent} has no bond") from None

    def total(self):
        """Posted money across all bonds, less what was slashed."""
        return sum(b.posted - b.slashed for b in self._bonds.values())
