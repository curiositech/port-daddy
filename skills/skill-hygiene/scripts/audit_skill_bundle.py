#!/usr/bin/env python3
"""Audit a skill bundle for surface-area drift.

Three checks, all generic — works on any progressive-disclosure skill that
follows the SKILL.md → directory INDEX.md → leaf doc pattern:

1. Orphaned assets: files in subdirectories that no INDEX.md or SKILL.md
   references. They will never be loaded.
2. INDEX drift: an INDEX.md that lists files no longer on disk, or omits
   files that are.
3. Missing INDEX: a non-trivial subdirectory (more than one asset) without
   an INDEX.md, so the contents have no entry point.

Exits 0 if clean, 1 if any drift found. Prints a punch list to stdout.

Usage:
    python3 audit_skill_bundle.py <skill_root>
    python3 audit_skill_bundle.py <skill_root> --json
    python3 audit_skill_bundle.py <skill_root> --quiet  # exit code only

Conventions assumed by the auditor (override with flags below):
- SKILL.md at the bundle root.
- Each subdirectory may have an INDEX.md; if it does, every other file in
  that subdirectory should be referenced (by basename) by either INDEX.md,
  SKILL.md, or another reachable file.
- Files starting with `.` and `__pycache__` are ignored.
- Directories named in IGNORED_DIRS are not audited (output, .git, etc.).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Iterable

IGNORED_DIRS = {".git", "__pycache__", "output", "node_modules", ".venv"}
IGNORED_FILE_PREFIXES = (".",)
IGNORED_FILE_NAMES = {"CHANGELOG.md", "README.md", "SKILL.md", "affordance-scorecard.json", "architecture.html"}


def is_ignored_file(path: Path) -> bool:
    if path.name.startswith(IGNORED_FILE_PREFIXES):
        return True
    if path.name in IGNORED_FILE_NAMES:
        return True
    if any(part in IGNORED_DIRS for part in path.parts):
        return True
    return False


def collect_subdir_files(skill_root: Path) -> dict[Path, list[Path]]:
    """Map each subdirectory to the audit-relevant files inside it (recursive)."""
    out: dict[Path, list[Path]] = {}
    for subdir in sorted(p for p in skill_root.iterdir() if p.is_dir() and p.name not in IGNORED_DIRS):
        files = [p for p in subdir.rglob("*") if p.is_file() and not is_ignored_file(p)]
        if files:
            out[subdir] = files
    return out


def load_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def references_basename(haystack: str, basename: str) -> bool:
    """Heuristic: basename appears as a literal string in the haystack.

    This catches markdown links, code spans, prose mentions, and path-prefixed
    references like ``scripts/foo.sh``. We deliberately avoid keyword-list NLP —
    we're looking for an exact filename, which is a structured string we control.

    The lookbehind excludes letters, digits, underscore, hyphen, and dot so we
    don't false-match `foo.sh` inside `myfoo.sh`. We allow `/` before the
    basename so path-prefixed mentions still count.
    """
    if not basename:
        return False
    pattern = r"(?<![A-Za-z0-9_\-\.])" + re.escape(basename) + r"(?![A-Za-z0-9])"
    return re.search(pattern, haystack) is not None


def collect_all_basenames(skill_root: Path) -> set[str]:
    """Every file basename in the bundle (for ghost-entry false-positive guarding).

    Unlike `is_ignored_file`, this only filters by directory and dotfile prefix.
    Files like SKILL.md, README.md, CHANGELOG.md exist on disk and may be
    referenced cross-directory; they are NOT ghosts.
    """
    out: set[str] = set()
    for p in skill_root.rglob("*"):
        if not p.is_file():
            continue
        if p.name.startswith(IGNORED_FILE_PREFIXES):
            continue
        if any(part in IGNORED_DIRS for part in p.parts):
            continue
        out.add(p.name)
    return out


def collect_reachable_text(skill_root: Path, subdir_files: dict[Path, list[Path]]) -> str:
    """Concatenate SKILL.md plus every INDEX.md across subdirectories."""
    chunks: list[str] = []
    skill_md = skill_root / "SKILL.md"
    if skill_md.exists():
        chunks.append(load_text(skill_md))
    for subdir in subdir_files:
        idx = subdir / "INDEX.md"
        if idx.exists():
            chunks.append(load_text(idx))
        # Also count nested INDEX.md (e.g., scripts/prologue/INDEX.md).
        for nested_idx in subdir.rglob("INDEX.md"):
            if nested_idx != idx:
                chunks.append(load_text(nested_idx))
    return "\n".join(chunks)


def audit(skill_root: Path) -> dict:
    subdir_files = collect_subdir_files(skill_root)
    reachable_text = collect_reachable_text(skill_root, subdir_files)
    all_basenames = collect_all_basenames(skill_root)

    orphans: list[str] = []
    drift: list[dict] = []
    missing_indexes: list[str] = []

    for subdir, files in subdir_files.items():
        rel_subdir = subdir.relative_to(skill_root)
        index_path = subdir / "INDEX.md"
        non_index_files = [f for f in files if f.name != "INDEX.md"]

        if not index_path.exists() and len(non_index_files) > 1:
            missing_indexes.append(str(rel_subdir))

        for f in non_index_files:
            rel = f.relative_to(skill_root)
            if not references_basename(reachable_text, f.name):
                orphans.append(str(rel))

        if index_path.exists():
            index_text = load_text(index_path)
            on_disk = {f.name for f in non_index_files if f.parent == subdir}
            mentioned = {
                name for name in on_disk
                if references_basename(index_text, name)
            }
            missing_from_index = sorted(on_disk - mentioned)
            if missing_from_index:
                drift.append({
                    "index": str(index_path.relative_to(skill_root)),
                    "missing_from_index": missing_from_index,
                })

            # Ghost detection: only flag entries that appear in a pipe-table
            # row's first column — that's where INDEX.md authors list bundled
            # files. Prose mentions of external artifacts (e.g. user-created
            # `pd-fleet.yml`) live outside tables and are NOT drift.
            table_first_col = re.findall(
                r"^\|\s*\[?`([A-Za-z0-9_\-/\.]+\.(?:md|json|ya?ml|sh|py))`",
                index_text,
                re.MULTILINE,
            )
            ghost_entries = sorted({
                stub for stub in table_first_col
                if "/" not in stub
                and stub not in on_disk
                and stub != "INDEX.md"
                and stub not in all_basenames
            })
            if ghost_entries:
                drift.append({
                    "index": str(index_path.relative_to(skill_root)),
                    "ghost_entries": ghost_entries,
                })

    return {
        "skill_root": str(skill_root),
        "orphans": sorted(orphans),
        "drift": drift,
        "missing_indexes": sorted(missing_indexes),
        "ok": not (orphans or drift or missing_indexes),
    }


def render_human(report: dict) -> str:
    lines: list[str] = []
    lines.append(f"Skill bundle: {report['skill_root']}")
    if report["ok"]:
        lines.append("OK: no drift detected.")
        return "\n".join(lines)

    if report["orphans"]:
        lines.append("")
        lines.append(f"Orphaned files ({len(report['orphans'])}) — bundled but no INDEX or SKILL.md mentions them:")
        for o in report["orphans"]:
            lines.append(f"  - {o}")

    if report["drift"]:
        lines.append("")
        lines.append("INDEX drift:")
        for d in report["drift"]:
            if "missing_from_index" in d:
                lines.append(f"  {d['index']}: missing entries for {', '.join(d['missing_from_index'])}")
            if "ghost_entries" in d:
                lines.append(f"  {d['index']}: lists files not on disk: {', '.join(d['ghost_entries'])}")

    if report["missing_indexes"]:
        lines.append("")
        lines.append("Subdirectories with multiple assets but no INDEX.md:")
        for m in report["missing_indexes"]:
            lines.append(f"  - {m}/")

    lines.append("")
    lines.append("Fix orphans by mentioning the file in SKILL.md or its directory's INDEX.md.")
    lines.append("Fix drift by updating INDEX.md to match the directory.")
    return "\n".join(lines)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("skill_root", help="path to the skill bundle (directory containing SKILL.md)")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of human text")
    parser.add_argument("--quiet", action="store_true", help="only set exit code, no output")
    args = parser.parse_args(list(argv) if argv is not None else None)

    root = Path(args.skill_root).resolve()
    if not (root / "SKILL.md").exists():
        print(f"ERROR: no SKILL.md at {root}", file=sys.stderr)
        return 2

    report = audit(root)

    if not args.quiet:
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print(render_human(report))

    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
