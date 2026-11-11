# desk

Support desk helpers. `deskkit/api.py` is the public entry point.

| File | Owner |
|---|---|
| `deskkit/api.py` | platform team |
| `deskkit/roster.py` | operations |
| `deskkit/routing.py` | whoever holds the claim for the open ticket |
| `tests/` | the ticket's requester |

Run the tests yourself with `python3 -m pytest -q` from this directory.
`./ci` runs the pipeline. `./promise` and `./release` open and close your
claim on the ticket's files.
