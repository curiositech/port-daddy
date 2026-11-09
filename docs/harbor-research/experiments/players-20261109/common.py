"""Shared paths, hashing and JSON helpers for the players-20261109 experiments.

Standard library only. Nothing here touches the Port Daddy runtime.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

EXP_DIR = Path(__file__).resolve().parent
RUNS_ROOT = Path(
    "/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad/exp-runs"
)
DRYRUN_ROOT = Path(
    "/tmp/claude-0/-home-claude/0d58d67c-91fe-5e53-93f2-1e6f62cdac74/scratchpad/exp-runs-dryrun"
)
SESSIONS_PATH = EXP_DIR / "sessions.json"
SEAL_PATH = EXP_DIR / "seal.json"
RESULTS_DIR = EXP_DIR / "results"

# Files and directories never part of a sealed tree or a diff.
IGNORED_NAMES = {"__pycache__", ".pytest_cache", ".DS_Store"}
IGNORED_SUFFIXES = (".pyc", ".pyo")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(Path(path).read_bytes())


def derive_seed(*parts: str) -> int:
    """Deterministic 64-bit seed from string parts (sealed master seed + context)."""
    digest = hashlib.sha256("\x1f".join(parts).encode()).digest()
    return int.from_bytes(digest[:8], "big")


def ignored(rel: str) -> bool:
    parts = rel.split("/")
    if any(p in IGNORED_NAMES for p in parts):
        return True
    return rel.endswith(IGNORED_SUFFIXES)


def tree_files(root: Path) -> dict[str, bytes]:
    """Map posix relative path -> bytes for every regular file under root."""
    root = Path(root)
    out: dict[str, bytes] = {}
    if not root.exists():
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_NAMES)
        for name in sorted(filenames):
            full = Path(dirpath) / name
            rel = full.relative_to(root).as_posix()
            if ignored(rel) or full.is_symlink():
                continue
            out[rel] = full.read_bytes()
    return out


def tree_hashes(root: Path) -> dict[str, str]:
    return {rel: sha256_bytes(data) for rel, data in tree_files(root).items()}


def diff_trees(base: dict[str, bytes], new: dict[str, bytes]) -> list[dict]:
    """File-level diff: list of {path, status} with status A, M or D."""
    changes = []
    for rel in sorted(set(base) | set(new)):
        if rel not in new:
            changes.append({"path": rel, "status": "D"})
        elif rel not in base:
            changes.append({"path": rel, "status": "A"})
        elif base[rel] != new[rel]:
            changes.append({"path": rel, "status": "M"})
    return changes


def dump_json(obj, path: Path | None = None) -> str:
    text = json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    if path is not None:
        Path(path).write_text(text)
    return text


def load_json(path: Path):
    return json.loads(Path(path).read_text())


def load_sessions() -> dict:
    return load_json(SESSIONS_PATH)


def session_record(session_id: str) -> dict:
    data = load_sessions()
    for s in data["sessions"]:
        if s["session_id"] == session_id:
            return s
    raise SystemExit(f"unknown session id {session_id!r}; see sessions.json")
