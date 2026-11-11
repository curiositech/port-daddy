# claims: list open claims by deadline

The status page needs each agent's open claims in the order they fall due. `ClaimBook.open_claims(agent=None)` returns the open claims sorted by deadline and then by claim id, for one agent or for all.
