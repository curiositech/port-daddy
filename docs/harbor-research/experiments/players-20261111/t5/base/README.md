# harborledger

A small ledger for agents that post bonds, claim tasks and get audited.

- `harborledger/money.py`: amounts in whole cents, shares in basis points.
- `harborledger/journal.py`: the append-only, hash-chained journal.
- `harborledger/bonds.py`: bonds, with money that is available, held or slashed.
- `harborledger/claims.py`: claims on tasks, their stakes and deadlines.
- `harborledger/audits.py`: the audit draw, verdicts and settlement.

`RULES.md` states what the code must keep. Times are whole numbers that the
caller supplies. Standard library only.

Run the tests from this directory:

    python3 -m unittest discover -s tests
