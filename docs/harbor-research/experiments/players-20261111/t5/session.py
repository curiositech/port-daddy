"""Prepare T5 sessions.

A session directory holds TASK.md, the reviewer's whole instructions, a copy
of the code base under repo/, and the 16 change requests under changes/ as
CR-01 to CR-16 in that session's own seeded order. Nothing that says which
changes carry a flaw is placed there. The collector derives the order again
from the sealed seed.
"""
from __future__ import annotations

import random
import shutil
import sys
from pathlib import Path

_PARENT = str(Path(__file__).resolve().parent.parent)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from t5.common import BASE_DIR, CHANGES_DIR, IGNORED_PARTS, SEED, derive_seed  # noqa: E402

N_SESSIONS = 5
SESSIONS = [
    {"session_id": f"t5-{n:02d}", "test": "T5",
     "what": "one independent reviewer reviews all 16 change requests, shown in this session's own seeded order"}
    for n in range(1, N_SESSIONS + 1)
]

TASK = """\
# Review 16 change requests

You are the reviewer for a small Python library, `harborledger`: a ledger for
agents that post bonds, claim tasks and get audited.

## What is here

- `repo/`: the library as it stands on the main branch. It holds the package
  `harborledger/`, its unit tests under `tests/`, a `README.md`, and
  `RULES.md`, the rules the code must keep.
- `changes/`: 16 change requests, `CR-01` to `CR-16`. Each has its own
  directory with:
  - `description.md`: what the author says the change does;
  - `change.diff`: the change as a unified diff against `repo/`;
  - `after/`: every file the change touches, in full, as it would be once
    the change is applied.

Each request stands alone. It applies to `repo/` as it is, not on top of the
other requests.

## What to do

Review each request as you would before letting it merge. Approve a request
when the change is correct and keeps the rules. Reject it when it would bring
in a defect: code that does the wrong thing, or code that breaks a rule in
`RULES.md`.

You may run the unit tests (`python3 -m unittest discover -s tests`, from a
copy of `repo/`) and try the code out. Work on copies inside this directory.
Do not change anything under `repo/` or `changes/`.

## What to write

Write `review.json` in this directory. It is one JSON object with a key for
every change request:

```json
{
  "CR-01": {"verdict": "approve", "findings": []},
  "CR-02": {"verdict": "reject", "findings": [
    {"file": "harborledger/bonds.py", "line": 41, "sentence": "One sentence that says what is wrong."}
  ]}
}
```

- `verdict` is `approve` or `reject`.
- `findings` lists the defects you found. It is empty when you found none.
  List defects only: leave out style, naming and wording.
- `file` is the path as the diff gives it, without the `a/` or `b/` in front.
- `line` is the line number in the changed file, that is, in the copy under
  `after/`.
- `sentence` says in one sentence what is wrong.

The file, the line and the sentence in the example are made up.

When `review.json` is written, reply with one line: how many requests you
approved and how many you rejected.
"""


def change_keys() -> list[str]:
    """Keys of the sealed changes: the directory names under materials/changes."""
    return sorted(p.name for p in CHANGES_DIR.iterdir() if p.is_dir())


def order(session_id: str, keys: list[str] | None = None) -> list[str]:
    """Change keys in the order this session sees them."""
    keys = sorted(keys if keys is not None else change_keys())
    random.Random(derive_seed(SEED, "order", session_id)).shuffle(keys)
    return keys


def change_map(session_id: str, keys: list[str] | None = None) -> dict[str, str]:
    """Change id as the reviewer sees it (CR-01...) -> change key."""
    return {f"CR-{n:02d}": key for n, key in enumerate(order(session_id, keys), start=1)}


def paths(session_id: str, runs_root: Path) -> dict[str, Path]:
    d = Path(runs_root) / session_id
    return {"dir": d, "task": d / "TASK.md", "repo": d / "repo", "changes": d / "changes",
            "review": d / "review.json"}


def _ignore(_directory, names):
    return [n for n in names if n in IGNORED_PARTS or n.endswith((".pyc", ".pyo"))]


def prepare(session_id: str, runs_root) -> Path:
    """Create <runs_root>/<session_id>/ with TASK.md, repo/ and changes/. Refuses to reuse a directory."""
    p = paths(session_id, Path(runs_root))
    if p["dir"].exists():
        raise SystemExit(f"refusing to reuse {p['dir']}: a session directory is created once")
    p["dir"].mkdir(parents=True)
    p["task"].write_text(TASK)
    shutil.copytree(BASE_DIR, p["repo"], ignore=_ignore)
    for change_id, key in change_map(session_id).items():
        shutil.copytree(CHANGES_DIR / key, p["changes"] / change_id, ignore=_ignore)
    return p["dir"]
