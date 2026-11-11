"""Paths, seeds and JSON helpers shared by the T4 modules. Standard library only."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXP_DIR = HERE.parent
TEST = "t4"
SEED = "players-20261111/t4/v1"

ITEMS_PATH = HERE / "items.json"
SOURCE_PATH = HERE / "genuine_source.json"
BENCHMARK_PATH = HERE / "benchmark.json"
RESULTS_DIR = EXP_DIR / "results"
DRYRUN_DIR = EXP_DIR / "dryrun"

_SCRATCH = Path("/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad")
RUNS_ROOT = _SCRATCH / "exp-runs-1111"
DRYRUN_ROOT = _SCRATCH / "exp-runs-1111-dryrun"


def derive_seed(*parts: str) -> int:
    """A 64-bit seed from the sealed master seed and a context."""
    digest = hashlib.sha256("\x1f".join(parts).encode()).digest()
    return int.from_bytes(digest[:8], "big")


def dump_json(obj) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def load_json(path: Path):
    return json.loads(Path(path).read_text())


def sha256_file(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
