#!/usr/bin/env python3
"""Audit a skill bundle for surface-area drift.

Generic auditor for any progressive-disclosure skill that follows the
SKILL.md -> directory INDEX.md -> leaf doc pattern.

Issue types
-----------

- orphan          : a doc file with no link or basename mention reachable
                    from SKILL.md or any INDEX.md. Will never be loaded.
- missing_from_index : a file lives next to an INDEX.md but the index
                    never mentions it.
- ghost_entry     : an INDEX.md table-row first column names a file that
                    does not exist anywhere in the bundle.
- broken_link     : a markdown link from a reachable file points at a path
                    that does not exist. (Optional typo suggestion attached.)
- missing_index   : a subdirectory has multiple bundled files but no
                    INDEX.md hub. WARNING only when SKILL.md already names
                    every file in the directory; otherwise FAILURE.

Exit codes
----------

0   clean
1   any failing issue
2   bundle malformed (no SKILL.md)

Usage
-----

    python3 audit_skill_bundle.py <skill_root>
    python3 audit_skill_bundle.py <skill_root> --json
    python3 audit_skill_bundle.py <skill_root> --quiet  # exit code only

Conventions
-----------

- SKILL.md at the bundle root.
- Each subdirectory may have an INDEX.md.
- Doc extensions audited: .md, .json, .yaml, .yml, .sh, .py, .ts, .js
- Asset extensions skipped from orphan detection (still validated as link
  targets when referenced): .svg, .png, .jpg, .jpeg, .gif, .ico, .webp,
  .ttf, .otf, .woff, .woff2, .mp4, .mp3, .pdf, .zip
- Files starting with `.` and `__pycache__` are ignored. Top-level bundle
  files (CHANGELOG.md, README.md, SKILL.md, affordance-scorecard.json,
  architecture.html) are not audited as bundled assets.

No keyword-based NLP. We only do exact filename matching (a structured
field we control) and standard markdown link parsing.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path
from typing import Iterable

IGNORED_DIRS = {".git", "__pycache__", "output", "node_modules", ".venv"}
IGNORED_FILE_PREFIXES = (".",)
IGNORED_FILE_NAMES = {"CHANGELOG.md", "README.md", "SKILL.md", "affordance-scorecard.json", "architecture.html", "provenance.json", "_book_identity.json", "_raw_response.md"}

DOC_EXTS = {".md", ".json", ".yaml", ".yml", ".sh", ".py", ".ts", ".js", ".txt"}
ASSET_EXTS = {
    ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
    ".ttf", ".otf", ".woff", ".woff2",
    ".mp4", ".mp3", ".pdf", ".zip", ".tar", ".gz",
}


def is_ignored_file(path: Path) -> bool:
    if path.name.startswith(IGNORED_FILE_PREFIXES):
        return True
    if path.name in IGNORED_FILE_NAMES:
        return True
    if any(part in IGNORED_DIRS for part in path.parts):
        return True
    return False


def is_doc(path: Path) -> bool:
    return path.suffix.lower() in DOC_EXTS


def is_asset(path: Path) -> bool:
    return path.suffix.lower() in ASSET_EXTS


def collect_subdir_files(skill_root: Path) -> dict[Path, list[Path]]:
    """Map each top-level subdirectory to the audit-relevant files inside (recursive)."""
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


def collect_all_basenames(skill_root: Path) -> set[str]:
    """Every file basename in the bundle (for ghost-entry false-positive guarding)."""
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


# ---------- Markdown link extraction ----------

_INLINE_LINK_RE = re.compile(r"\[([^\]\n]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
_REF_LINK_RE = re.compile(r"\[([^\]\n]+)\]\[([^\]\n]+)\]")
_REF_DEF_RE = re.compile(r"^\s*\[([^\]\n]+)\]:\s*(\S+)", re.MULTILINE)
_CODESPAN_FILE_RE = re.compile(r"`([A-Za-z0-9_\-/\.]+\.(?:md|json|ya?ml|sh|py|ts|js|txt|svg|png|jpg|jpeg|gif|html))`")
_EXTERNAL_RE = re.compile(r"^(?:[a-z][a-z0-9+.\-]*://|mailto:|tel:)", re.IGNORECASE)


def extract_links(text: str) -> list[tuple[str, str, str]]:
    """Return list of (kind, raw_target, link_text) tuples — only ASSERTION-STYLE
    links: inline `[text](path)` and reference-style `[text][id]` + `[id]: path`.

    Backtick-quoted code spans like ``INDEX.md`` are prose mentions of a
    filename, not link assertions — we extract those separately via
    `extract_codespan_filenames` and use them only to populate the
    referenced-basename set, never to claim a path must resolve.
    """
    links: list[tuple[str, str, str]] = []
    refs: dict[str, str] = {}
    for m in _REF_DEF_RE.finditer(text):
        refs[m.group(1).lower()] = m.group(2)

    for m in _INLINE_LINK_RE.finditer(text):
        links.append(("inline", m.group(2), m.group(1)))
    for m in _REF_LINK_RE.finditer(text):
        label = m.group(2).lower()
        if label in refs:
            links.append(("reference", refs[label], m.group(1)))
    return links


def extract_codespan_filenames(text: str) -> set[str]:
    """Return basenames mentioned in backtick code spans.

    Used only for "this filename is mentioned somewhere reachable" — never
    for path resolution. A prose mention does not assert the file lives at
    a particular path.
    """
    out: set[str] = set()
    for m in _CODESPAN_FILE_RE.finditer(text):
        # If the codespan contains a path, take the basename.
        out.add(m.group(1).rsplit("/", 1)[-1])
    return out


def classify_link(target: str, container_dir: Path, skill_root: Path) -> tuple[str, Path | None]:
    """Categorise a link.

    Returns (status, resolved_relative_path_or_None).
    status in {"external", "anchor", "ok", "broken", "outside"}.
    """
    if _EXTERNAL_RE.match(target):
        return "external", None
    if target.startswith("#"):
        return "anchor", None
    path_part = target.split("#", 1)[0].split("?", 1)[0]
    if not path_part:
        return "anchor", None
    resolved = (container_dir / path_part).resolve()
    try:
        rel = resolved.relative_to(skill_root.resolve())
    except ValueError:
        return "outside", None
    if resolved.exists():
        return "ok", rel
    return "broken", rel


# ---------- Audit ----------

def audit(skill_root: Path) -> dict:
    skill_root = skill_root.resolve()
    subdir_files = collect_subdir_files(skill_root)
    all_basenames = collect_all_basenames(skill_root)

    # Files containing references we trust: SKILL.md + every INDEX.md.
    reachable_files: list[Path] = []
    skill_md = skill_root / "SKILL.md"
    if skill_md.exists():
        reachable_files.append(skill_md)
    for subdir in subdir_files:
        for p in subdir.rglob("INDEX.md"):
            reachable_files.append(p)

    # Build link inventory across reachable files.
    referenced_paths: set[Path] = set()        # files explicitly linked
    referenced_basenames: set[str] = set()     # basenames mentioned anywhere reachable
    broken_links: list[dict] = []
    skill_md_text = load_text(skill_md) if skill_md.exists() else ""

    for rf in reachable_files:
        text = load_text(rf)
        # Track every basename literally mentioned in the text (catches prose).
        for bn in all_basenames:
            if re.search(r"(?<![A-Za-z0-9_\-\.])" + re.escape(bn) + r"(?![A-Za-z0-9])", text):
                referenced_basenames.add(bn)
        # Codespan filename mentions also count toward "referenced".
        for bn in extract_codespan_filenames(text):
            referenced_basenames.add(bn)
        for kind, target, link_text in extract_links(text):
            status, rel = classify_link(target, rf.parent, skill_root)
            if status == "ok" and rel is not None:
                referenced_paths.add(rel)
            elif status == "broken" and rel is not None:
                # Suggest typo fix: look in the resolved parent directory for
                # close matches.
                suggestions: list[str] = []
                parent = (skill_root / rel.parent).resolve()
                if parent.is_dir():
                    candidates = [p.name for p in parent.iterdir() if p.is_file()]
                    suggestions = difflib.get_close_matches(rel.name, candidates, n=2, cutoff=0.75)
                broken_links.append({
                    "from": str(rf.relative_to(skill_root)),
                    "target": target,
                    "resolved": str(rel),
                    "kind": kind,
                    "suggestions": suggestions,
                })

    orphans: list[str] = []
    drift: list[dict] = []
    missing_indexes_failure: list[str] = []
    missing_indexes_warning: list[str] = []

    for subdir, files in subdir_files.items():
        rel_subdir = subdir.relative_to(skill_root)
        index_path = subdir / "INDEX.md"
        non_index_files = [f for f in files if f.name != "INDEX.md"]
        doc_files = [f for f in non_index_files if is_doc(f)]

        # Orphan check: only docs, not assets.
        for f in doc_files:
            rel = f.relative_to(skill_root)
            if rel in referenced_paths:
                continue
            if f.name in referenced_basenames:
                continue
            orphans.append(str(rel))

        # Missing INDEX check: warn or fail depending on whether SKILL.md
        # already names the files directly.
        if not index_path.exists() and len(non_index_files) > 1:
            all_named_in_skill = all(
                f.name in referenced_basenames or f.relative_to(skill_root) in referenced_paths
                for f in doc_files
            )
            if all_named_in_skill and doc_files:
                missing_indexes_warning.append(str(rel_subdir))
            else:
                missing_indexes_failure.append(str(rel_subdir))

        if index_path.exists():
            index_text = load_text(index_path)
            on_disk = {f.name for f in non_index_files if f.parent == subdir and (is_doc(f) or is_asset(f))}
            # Asset files in INDEX-mention check: only require mention for docs.
            on_disk_docs = {f.name for f in non_index_files if f.parent == subdir and is_doc(f)}
            mentioned = {
                name for name in on_disk_docs
                if re.search(r"(?<![A-Za-z0-9_\-\.])" + re.escape(name) + r"(?![A-Za-z0-9])", index_text)
            }
            missing_from_index = sorted(on_disk_docs - mentioned)
            if missing_from_index:
                drift.append({
                    "index": str(index_path.relative_to(skill_root)),
                    "missing_from_index": missing_from_index,
                })

            # Ghost detection: pipe-table first-column entries whose file does
            # not exist anywhere in the bundle.
            table_first_col = re.findall(
                r"^\|\s*\[?`([A-Za-z0-9_\-/\.]+\.(?:md|json|ya?ml|sh|py|ts|js|txt))`",
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

    ok = not (orphans or drift or missing_indexes_failure or broken_links)
    return {
        "skill_root": str(skill_root),
        "orphans": sorted(orphans),
        "drift": drift,
        "missing_indexes_failure": sorted(missing_indexes_failure),
        "missing_indexes_warning": sorted(missing_indexes_warning),
        "broken_links": broken_links,
        "ok": ok,
    }


def render_human(report: dict) -> str:
    lines: list[str] = []
    lines.append(f"Skill bundle: {report['skill_root']}")
    if report["ok"] and not report.get("missing_indexes_warning"):
        lines.append("OK: no drift detected.")
        return "\n".join(lines)
    if report["ok"]:
        lines.append("OK: no failing issues (warnings below).")

    if report["orphans"]:
        lines.append("")
        lines.append(f"Orphaned files ({len(report['orphans'])}) — bundled docs no SKILL.md or INDEX.md references:")
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

    if report["broken_links"]:
        lines.append("")
        lines.append(f"Broken links ({len(report['broken_links'])}):")
        for b in report["broken_links"]:
            suffix = ""
            if b.get("suggestions"):
                suffix = f"  -> did you mean: {', '.join(b['suggestions'])}?"
            lines.append(f"  {b['from']}: {b['target']} (resolves to {b['resolved']}){suffix}")

    if report["missing_indexes_failure"]:
        lines.append("")
        lines.append("Subdirectories with bundled docs but no INDEX.md, and not all files named in SKILL.md:")
        for m in report["missing_indexes_failure"]:
            lines.append(f"  - {m}/")

    if report.get("missing_indexes_warning"):
        lines.append("")
        lines.append("Subdirectories with no INDEX.md but every file is named in SKILL.md (warning, not failure):")
        for m in report["missing_indexes_warning"]:
            lines.append(f"  - {m}/")

    if not report["ok"]:
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
