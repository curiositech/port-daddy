"""Paths and seeds shared by the T5 modules, with two JSON helpers. Standard library only."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP_DIR = HERE.parent
TEST = "t5"
SEED = "players-20261111/t5/v1"

BASE_DIR = HERE / "base"
MATERIALS = HERE / "materials"
CHANGES_DIR = MATERIALS / "changes"
PROBES_DIR = MATERIALS / "probes"
TRUTH_PATH = MATERIALS / "ground_truth.json"
VERIFICATION_PATH = MATERIALS / "verification.json"
SESSIONS_PATH = MATERIALS / "sessions.json"
POWER_PATH = MATERIALS / "power.json"
RESULTS_DIR = EXP_DIR / "results"
DRYRUN_DIR = EXP_DIR / "dryrun"

_SCRATCH = Path("/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad")
RUNS_ROOT = _SCRATCH / "exp-runs-1111"
DRYRUN_ROOT = _SCRATCH / "exp-runs-1111-dryrun"

IGNORED_PARTS = {"__pycache__", ".pytest_cache", ".DS_Store"}


def derive_seed(*parts: str) -> int:
    """A 64-bit seed from the sealed master seed and a context."""
    digest = hashlib.sha256("\x1f".join(parts).encode()).digest()
    return int.from_bytes(digest[:8], "big")


def dump_json(obj) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def load_json(path: Path):
    return json.loads(Path(path).read_text())


def tree_text(root: Path) -> dict[str, str]:
    """Posix relative path -> text for every file under root, in sorted order."""
    out = {}
    for path in sorted(Path(root).rglob("*")):
        rel = path.relative_to(root)
        if path.is_file() and not (set(rel.parts) & IGNORED_PARTS) and path.suffix not in (".pyc", ".pyo"):
            out[rel.as_posix()] = path.read_text()
    return out


def sha256_tree(root: Path) -> str:
    """One hash over every file under root: paths and contents."""
    h = hashlib.sha256()
    for rel, text in tree_text(root).items():
        h.update(rel.encode() + b"\0" + text.encode() + b"\0")
    return h.hexdigest()
