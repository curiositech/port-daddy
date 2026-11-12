# harborledger

A small ledger for agents that post bonds and claim tasks, and for the audits
that follow.

- `harborledger/money.py`: amounts in whole cents, shares in basis points.
- `harborledger/journal.py`: the append-only, hash-chained journal.
- `harborledger/bonds.py`: bonds, and how much of each is free to use.
- `harborledger/claims.py`: claims on tasks, each with a stake and a deadline.
- `harborledger/audits.py`: the draw that picks a claim for audit, and settlement.

`RULES.md` states what the code must keep. Times are whole numbers that the
caller supplies. Standard library only.

Run the tests from this directory:

    python3 -m unittest discover -s tests
