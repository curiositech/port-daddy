"""T6 sessions: which they are, and how one is prepared for a subject.

A session directory holds TASK.md, the subject's whole instructions, and
questions.md, the situations and then the questions in that session's own
order. The subject adds estimates.json. Nothing in the directory says which
question is which item: question numbers are positions, and the collector
re-derives the order from the seed.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from t6 import design, kit  # noqa: E402

SESSIONS = design.SESSIONS
ANSWERS_FILE = design.ANSWERS_FILE
GIVEN_FILES = ("TASK.md", "questions.md")


class SessionError(RuntimeError):
    """A session cannot be prepared as sealed."""


def session_dir(session_id: str, runs_root: Path = kit.RUNS_ROOT) -> Path:
    return Path(runs_root) / session_id


def sealed_hashes(session_id: str) -> dict[str, str]:
    if not design.SESSIONS_PATH.exists():
        raise SessionError("sessions.json is missing; run `python3 t6/design.py build` first")
    for row in kit.load_json(design.SESSIONS_PATH)["sessions"]:
        if row["session_id"] == session_id:
            return row["files_sha256"]
    raise SessionError(f"{session_id} is not in sessions.json")


def prepare(session_id: str, runs_root: Path = kit.RUNS_ROOT) -> Path:
    """Create <runs_root>/<session_id>/ with everything the subject needs. Returns the directory."""
    try:
        files = design.render_session(session_id)
    except KeyError as exc:
        raise SessionError(str(exc)) from None
    sealed = sealed_hashes(session_id)
    for name, text in files.items():
        if kit.sha256_text(text) != sealed.get(name):
            raise SessionError(f"refusing to prepare {session_id}: {name} differs from the hash in sessions.json")
    target = session_dir(session_id, runs_root)
    if target.exists():
        raise SessionError(f"refusing to reuse {target}: a session directory is created once")
    target.mkdir(parents=True)
    for name, text in files.items():
        (target / name).write_text(text)
    return target
