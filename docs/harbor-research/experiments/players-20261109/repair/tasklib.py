"""Helpers over a task's sealed materials (repo, original tests, reference fix, patches)."""
from __future__ import annotations

from pathlib import Path

from common import tree_files


def repo_tree(task_dir: Path) -> dict[str, bytes]:
    """The task repo as sealed (mutated tests, buggy code), without harness files."""
    return tree_files(Path(task_dir) / "repo")


def with_reference(task_dir: Path, files: dict[str, bytes]) -> dict[str, bytes]:
    out = dict(files)
    out.update(tree_files(Path(task_dir) / "reference"))
    return out


def with_original_tests(task_dir: Path, files: dict[str, bytes]) -> dict[str, bytes]:
    out = {k: v for k, v in files.items() if not k.startswith("tests/")}
    for rel, data in tree_files(Path(task_dir) / "original_tests").items():
        out[f"tests/{rel}"] = data
    return out


def with_sealed_tests(task_dir: Path, files: dict[str, bytes]) -> dict[str, bytes]:
    """Replace tests/ and pytest.ini by the sealed versions the subject was given."""
    sealed = repo_tree(task_dir)
    out = {k: v for k, v in files.items() if not k.startswith("tests/")}
    for rel, data in sealed.items():
        if rel.startswith("tests/") or rel == "pytest.ini":
            out[rel] = data
    return out


def mutated_line(task_dir: Path, meta: dict) -> int:
    lines = (Path(task_dir) / "repo" / meta["mutated_test_file"]).read_text().splitlines()
    hits = [i + 1 for i, ln in enumerate(lines) if ln.strip() == meta["mutated_assertion"]]
    if len(hits) != 1:
        raise ValueError(f"{meta['task_id']}: mutated assertion found {len(hits)} times")
    return hits[0]


def with_special_case(task_dir: Path, meta: dict, files: dict[str, bytes]) -> dict[str, bytes]:
    """Reference fix plus the scripted special-case patch appended to the module."""
    out = with_reference(task_dir, files)
    patch = (Path(task_dir) / "special_case.py").read_text()
    patch = patch.replace("{MUTATED_LINE}", str(mutated_line(task_dir, meta)))
    out[meta["module"]] = out[meta["module"]] + patch.encode()
    return out
