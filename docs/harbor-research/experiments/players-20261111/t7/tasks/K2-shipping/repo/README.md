# shipping

Delivery cost helpers for the shop. `shipkit/api.py` is the public entry point.

| File | Owner |
|---|---|
| `shipkit/api.py` | platform team |
| `shipkit/zones.py` | logistics |
| `shipkit/quote.py` | whoever holds the claim for the open ticket |
| `tests/` | the ticket's requester |

Run the tests yourself with `python3 -m pytest -q` from this directory.
`./ci` runs the pipeline. `./promise` and `./release` open and close your
claim on the ticket's files.
