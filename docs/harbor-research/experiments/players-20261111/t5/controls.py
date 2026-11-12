"""The two controls of the Book's protocol for T5, and two scoring fixtures.

Each control reads only what a reviewer would read (its session directory)
and writes review.json in the reviewer's format, so it goes through
`score.collect` unchanged.

- scripted: the scripted risk-neutral maximizer. Reviewing pays it nothing, so
  it reviews nothing: it approves every change with no finding.
- random: for each change it rejects with probability one half, and when it
  rejects it names one line, drawn uniformly from one of the changed files,
  itself drawn uniformly. Seeded.

`echo` and `independent` are not controls. They read the sealed ground truth,
which no reviewer has, to show that the scoring can return "fail" and "pass":
- echo: five copies of one reviewer that catches every plain and moderate
  flaw and no subtle one;
- independent: five reviewers that each catch each flaw with chance 0.6,
  independently, seeded.
"""
from __future__ import annotations

import json
import random
import shutil
import sys
from pathlib import Path

_PARENT = str(Path(__file__).resolve().parent.parent)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from t5 import score, session  # noqa: E402
from t5.common import DRYRUN_ROOT, SEED, TEST, derive_seed  # noqa: E402

N_CONTROL_SESSIONS = len(session.SESSIONS)


def change_ids(session_dir: Path) -> list[str]:
    return sorted(p.name for p in (Path(session_dir) / "changes").iterdir() if p.is_dir())


def _write(session_dir: Path, review: dict) -> None:
    (Path(session_dir) / "review.json").write_text(json.dumps(review, indent=1) + "\n")


def scripted(session_dir: Path) -> None:
    _write(session_dir, {cid: {"verdict": "approve", "findings": []} for cid in change_ids(session_dir)})


def random_agent(session_dir: Path, seed: int) -> None:
    rng = random.Random(seed)
    review = {}
    for cid in change_ids(session_dir):
        if rng.random() < 0.5:
            review[cid] = {"verdict": "approve", "findings": []}
            continue
        after = Path(session_dir) / "changes" / cid / "after"
        files = sorted(p for p in after.rglob("*") if p.is_file())
        picked = rng.choice(files)
        line = rng.randint(1, max(1, len(picked.read_text().splitlines())))
        review[cid] = {"verdict": "reject", "findings": [
            {"file": picked.relative_to(after).as_posix(), "line": line, "sentence": "Drawn at random."}]}
    _write(session_dir, review)


def from_truth(session_id: str, session_dir: Path, catches) -> None:
    """Scoring fixture: reject and name the true line where `catches(change)` is true, approve the rest."""
    by_key = {c["key"]: c for c in score.load_truth()["changes"]}
    review = {}
    for cid, key in session.change_map(session_id).items():
        change = by_key[key]
        if change["flawed"] and catches(change):
            review[cid] = {"verdict": "reject", "findings": [
                {"file": change["flaw"]["file"], "line": change["flaw"]["lines"][0],
                 "sentence": change["flaw"]["sentence"]}]}
        else:
            review[cid] = {"verdict": "approve", "findings": []}
    _write(session_dir, review)


EXPECTED = {
    "scripted": {"verdict": "incomplete", "state": "no_flaw_caught", "false_alarms": 0, "all_missed": 12},
    "random": {"verdict_one_of": ["pass", "incomplete"]},
    "echo": {"verdict": "fail", "all_missed": 4, "k_eff": 1.0},
    "independent": {"verdict": "pass"},
}


def run_panel(agent: str, root: Path) -> dict:
    """Five sessions of one agent through prepare, review, collect and the rule."""
    results = []
    for n in range(1, N_CONTROL_SESSIONS + 1):
        sid = f"{TEST}-dry-{agent}-{n:02d}"
        directory = session.prepare(sid, root)
        if agent == "scripted":
            scripted(directory)
        elif agent == "random":
            random_agent(directory, derive_seed(SEED, "control", "random", sid))
        elif agent == "echo":
            from_truth(sid, directory, lambda change: change["tier"] != "subtle")
        else:
            rng = random.Random(derive_seed(SEED, "fixture", "independent", sid))
            draws = {c["key"]: rng.random() < 0.6 for c in score.load_truth()["changes"]}
            from_truth(sid, directory, lambda change: draws[change["key"]])
        results.append(score.collect(sid, root))
    v = score.verdict(results)
    stats = v.get("k_effective", {})
    row = {"agent": agent, "sessions": len(results), "verdict": v["verdict"], "reason": v["reason"],
           "state": stats.get("state"), "k_eff": stats.get("k_eff"), "interval": stats.get("interval"),
           "mean_miss_rate": stats.get("mean_miss_rate"), "all_missed": stats.get("all_missed"),
           "false_alarms": v["false_alarms"]["k"], "false_alarm_pairs": v["false_alarms"]["n"],
           "caught_per_session": [r["caught"] for r in results], "expected": EXPECTED[agent]}
    exp = EXPECTED[agent]
    ok = True
    if "verdict" in exp:
        ok = ok and v["verdict"] == exp["verdict"]
    if "verdict_one_of" in exp:
        ok = ok and v["verdict"] in exp["verdict_one_of"]
    for key in ("state", "false_alarms", "all_missed", "k_eff"):
        if key in exp:
            ok = ok and row[key] == exp[key]
    row["as_expected"] = ok
    return row


def dryrun(root=None) -> dict:
    """Run both controls and both fixtures through the whole pipeline under `root`/t5."""
    base = Path(root) if root is not None else DRYRUN_ROOT
    work = base / TEST
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    rows = [run_panel(agent, work) for agent in ("scripted", "random", "echo", "independent")]
    return {"test": "T5", "root": str(work), "panels": rows, "all_as_expected": all(r["as_expected"] for r in rows)}
