"""Prepare and collect T1 sessions.

A T1 session directory holds work/offers.md (48 offers in the session's
sealed order) and, after the run, work/answers.json written by the subject.
Nothing that maps offers to frames or budgets is placed in the directory;
the collector re-derives the order from the sealed seed.
"""
from __future__ import annotations

from pathlib import Path

from common import EXP_DIR, load_json, sha256_bytes
from t1.design import PROMPT_TEMPLATE, render_offers
from t1.score import score_session

ITEMS_PATH = EXP_DIR / "t1" / "items.json"
BENCHMARK_PATH = EXP_DIR / "t1" / "random_benchmark.json"


def paths(session_id: str, root: Path) -> dict[str, Path]:
    work = Path(root) / session_id / "work"
    return {"dir": Path(root) / session_id, "work": work,
            "offers": work / "offers.md", "answers": work / "answers.json"}


def offers_bytes(session_id: str, items_doc: dict | None = None) -> bytes:
    items_doc = items_doc or load_json(ITEMS_PATH)
    text, _ = render_offers(session_id, items_doc)
    return text.encode()


def prompt(session_id: str, root: Path) -> str:
    p = paths(session_id, root)
    return PROMPT_TEMPLATE.format(offers_path=p["offers"], answers_path=p["answers"])


def prepare(session_id: str, root: Path, expected_sha: str | None = None) -> Path:
    p = paths(session_id, root)
    data = offers_bytes(session_id)
    if expected_sha is not None and sha256_bytes(data) != expected_sha:
        raise SystemExit("refusing to prepare: rendered offers differ from the sealed hash in sessions.json")
    if p["dir"].exists():
        raise SystemExit(f"refusing to reuse {p['dir']}: session directories are created once")
    p["work"].mkdir(parents=True)
    p["offers"].write_bytes(data)
    return p["dir"]


def collect(session: dict, root: Path) -> dict:
    sid = session["session_id"]
    p = paths(sid, root)
    if not p["dir"].exists():
        return {"session_id": sid, "error": f"no session directory at {p['dir']}"}
    expected = offers_bytes(sid)
    offers_ok = p["offers"].exists() and p["offers"].read_bytes() == expected
    result = score_session(sid, p["answers"], load_json(ITEMS_PATH), load_json(BENCHMARK_PATH))
    result["experiment"] = "A"
    result["offers_file_unchanged"] = offers_ok
    extra = sorted(x.name for x in p["work"].iterdir() if x.name not in ("offers.md", "answers.json"))
    result["other_files_in_work_dir"] = extra
    return result
