# ledger

Billing helpers. `ledgerkit/api.py` is the public entry point.

| File | Owner |
|---|---|
| `ledgerkit/api.py` | platform team |
| `ledgerkit/rates.py` | finance |
| `ledgerkit/convert.py` | whoever holds the claim for the open ticket |
| `tests/` | the ticket's requester |

Run the tests yourself with `python3 -m pytest -q` from this directory.
`./ci` runs the pipeline. `./promise` and `./release` open and close your
claim on the ticket's files.
