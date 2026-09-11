#!/usr/bin/env python3
"""check_figure_register.py -- validates docs/harbor-research/exposition/figures/
FIGURE-REGISTER.md and FIGURE-TRIAGE.md against the contract documented in
docs/harbor-research/exposition/figures/figure-register.schema.md.

Stdlib-only. Born from the PR #10069 review: a hand-authored register and
triage doc with no drift check, sitting next to a whitepaper corpus where
every other cross-reference (citations, the library index, the atlas) has
one.

Checks, over both files:
  1. malformed rows      -- a data row (matched by its leading id/index cell)
                             that does not split into the expected column
                             count, respecting Markdown's `\\|` escape.
  2. unknown enum values -- structure, wave-11 disposition, priority (register);
                             role, disposition (triage) -- see the schema doc
                             for the exact vocabularies and the "leading
                             token" extraction rule for disposition cells.
  3. duplicate ids        -- a FIGURE-REGISTER.md `id` reused across rows.
  4. chapter numbers      -- every `## Chapter N -- Title` heading in either
                             file, and every register row id's `chN-` prefix,
                             must name a chapter 1-8 whose number and title
                             match whitepaper/textbook.json exactly.
  5. fragment existence   -- a FIGURE-TRIAGE.md fragment named on a `keep` or
                             `restyle` row must exist as `<fragment>.tex`
                             under one of the three figure corpora (a
                             `redraw`/`table`/`delete`/`add` row's fragment is
                             allowed to already be gone -- see the schema doc).

Usage:
    python3 scripts/harbor-research/check_figure_register.py [--verbose]

Exit status: 0 iff no failures; 1 otherwise (including a missing/unparseable
input file).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

REGISTER_REL = "docs/harbor-research/exposition/figures/FIGURE-REGISTER.md"
TRIAGE_REL = "docs/harbor-research/exposition/figures/FIGURE-TRIAGE.md"
TEXTBOOK_REL = "whitepaper/textbook.json"

FIGURE_DIRS = (
    "whitepaper/figures",
    "website-v2/public/whitepaper/figures",
    "docs/harbor-research/figures",
)

STRUCTURE_ENUM = {
    "temporal", "stateful", "quantitative", "relational",
    "containment", "provenance", "allocation", "comparison",
}
PRIORITY_ENUM = {"must", "should", "could", "no"}
DISPOSITION_ENUM = {"keep", "restyle", "redraw", "table", "delete", "add"}
ROLE_ENUM = {"carries", "supports", "decorates", "interrupts"}

# The one row the register's own "Register summary" prose documents as
# folded into an adjacent row, exempting it from the must/should/could/no
# count. See figure-register.schema.md's priority column note.
FOLDED_REGISTER_IDS = {"ch2-34"}

CHAPTER_HEADING_RE = re.compile(r"^## Chapter (\d+)\s*(?:—|--|-)\s*(.+?)\s*(?:\(.*\))?\s*$")
ANY_H2_RE = re.compile(r"^## ")
REGISTER_ROW_RE = re.compile(r"^\|\s*(ch(\d+)-\d+)\s*\|")
TRIAGE_ROW_RE = re.compile(r"^\|\s*(\d+\.\d+|add)\s*\|")
SHARED_SUFFIX_RE = re.compile(r"\s*\(shared with[^)]*\)\s*$")


def rel(path: str) -> str:
    return os.path.relpath(path, REPO_ROOT)


def abspath(rel_path: str) -> str:
    return os.path.join(REPO_ROOT, rel_path)


def read_lines(rel_path: str) -> list[str] | None:
    p = abspath(rel_path)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as fh:
        return fh.read().split("\n")


def split_table_row(line: str) -> list[str]:
    """Split one Markdown table row into cells, respecting the `\\|` escape
    (used in this register for LaTeX norm bars like `\\|s\\|`). A bare `|`
    is a column boundary; `\\|` is not."""
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|"):
        inner = inner[:-1]
    placeholder = "\x00"
    protected = inner.replace("\\|", placeholder)
    return [c.replace(placeholder, "\\|").strip() for c in protected.split("|")]


def leading_token(cell: str) -> str:
    """The enum token a disposition/role cell leads with: strip `**` bold
    markers, then take the text up to the first space or '('."""
    cleaned = cell.replace("*", "").strip()
    if cleaned == "—":
        return "—"
    return cleaned.split(" ")[0].split("(")[0].strip()


def load_textbook() -> dict:
    with open(abspath(TEXTBOOK_REL), encoding="utf-8") as fh:
        return json.load(fh)


def chapters_by_number(textbook: dict) -> dict[int, dict]:
    return {c["number"]: c for c in textbook["chapters"]}


# ---------------------------------------------------------------------------
# Chapter heading checks (shared by both files)
# ---------------------------------------------------------------------------

def check_chapter_headings(lines: list[str], rel_path: str, by_number: dict[int, dict]) -> tuple[list[str], dict[int, int | None]]:
    """Returns (failures, {line_no: chapter_number_or_None}) for EVERY `## `
    heading line (chapter or not), so callers can look up "what chapter's
    table is this row inside" -- and correctly say None once the file has
    moved on to a non-chapter section like `## Totals`, not just carry the
    last-seen chapter number forward forever."""
    failures: list[str] = []
    heading_chapter: dict[int, int | None] = {}
    seen: set[int] = set()
    for i, line in enumerate(lines, 1):
        if not ANY_H2_RE.match(line):
            continue
        m = CHAPTER_HEADING_RE.match(line)
        if not m:
            heading_chapter[i] = None
            continue
        n = int(m.group(1))
        title = m.group(2).strip()
        heading_chapter[i] = n
        seen.add(n)
        tb = by_number.get(n)
        if tb is None:
            failures.append(f"{rel_path}:{i}: '## Chapter {n}' has no matching chapter in {TEXTBOOK_REL}")
            continue
        if tb["title"] != title:
            failures.append(
                f"{rel_path}:{i}: heading title '{title}' does not match "
                f"{TEXTBOOK_REL} chapter {n} title '{tb['title']}'"
            )
    expected = set(by_number.keys())
    if seen != expected:
        missing = sorted(expected - seen)
        extra = sorted(seen - expected)
        if missing:
            failures.append(f"{rel_path}: missing chapter heading(s) for {missing} (present in {TEXTBOOK_REL})")
        if extra:
            failures.append(f"{rel_path}: chapter heading(s) {extra} do not exist in {TEXTBOOK_REL}")
    return failures, heading_chapter


def chapter_for_line(line_no: int, heading_chapter: dict[int, int | None]) -> int | None:
    current: int | None = None
    for h_line in sorted(heading_chapter):
        if h_line <= line_no:
            current = heading_chapter[h_line]
        else:
            break
    return current


# ---------------------------------------------------------------------------
# FIGURE-REGISTER.md
# ---------------------------------------------------------------------------

def check_register(by_number: dict[int, dict]) -> list[str]:
    failures: list[str] = []
    lines = read_lines(REGISTER_REL)
    if lines is None:
        return [f"{REGISTER_REL} does not exist"]

    heading_failures, heading_chapter = check_chapter_headings(lines, REGISTER_REL, by_number)
    failures.extend(heading_failures)

    seen_ids: dict[str, int] = {}
    for i, line in enumerate(lines, 1):
        m = REGISTER_ROW_RE.match(line)
        if not m:
            continue
        if chapter_for_line(i, heading_chapter) is None:
            continue  # a `ch<N>-<NN>`-shaped id outside any chapter table (none expected; be safe anyway)
        rid, id_chapter_str = m.group(1), m.group(2)
        cells = split_table_row(line)
        if len(cells) != 11:
            failures.append(
                f"{REGISTER_REL}:{i}: row '{rid}' has {len(cells)} columns, expected 11 "
                f"(malformed row -- check for an un-escaped '|' in a cell)"
            )
            continue

        if rid in seen_ids:
            failures.append(f"{REGISTER_REL}:{i}: duplicate id '{rid}' (first seen at line {seen_ids[rid]})")
        else:
            seen_ids[rid] = i

        id_chapter = int(id_chapter_str)
        if id_chapter not in by_number:
            failures.append(f"{REGISTER_REL}:{i}: row '{rid}' names chapter {id_chapter}, not in {TEXTBOOK_REL}")
        section_chapter = chapter_for_line(i, heading_chapter)
        if section_chapter is not None and section_chapter != id_chapter:
            failures.append(
                f"{REGISTER_REL}:{i}: row '{rid}' is under the Chapter {section_chapter} heading "
                f"but its id names chapter {id_chapter}"
            )

        _id, _section, _idea, structure, _rq, _form, existing_figure, disposition, priority, _src, _notes = cells

        if structure not in STRUCTURE_ENUM:
            failures.append(f"{REGISTER_REL}:{i}: row '{rid}' has unknown structure '{structure}'")

        if not existing_figure:
            failures.append(f"{REGISTER_REL}:{i}: row '{rid}' has an empty existing-figure cell")

        disp_token = leading_token(disposition)
        if disp_token not in DISPOSITION_ENUM and disp_token != "—":
            failures.append(
                f"{REGISTER_REL}:{i}: row '{rid}' has unknown wave-11 disposition '{disposition}' "
                f"(leading token '{disp_token}')"
            )

        if priority not in PRIORITY_ENUM:
            if not (priority == "—" and rid in FOLDED_REGISTER_IDS):
                failures.append(
                    f"{REGISTER_REL}:{i}: row '{rid}' has unknown priority '{priority}' "
                    f"(expected one of {sorted(PRIORITY_ENUM)}, or '—' for a documented folded row)"
                )

    return failures


# ---------------------------------------------------------------------------
# FIGURE-TRIAGE.md
# ---------------------------------------------------------------------------

def fragment_exists(fragment: str) -> bool:
    return any(os.path.isfile(abspath(os.path.join(d, fragment + ".tex"))) for d in FIGURE_DIRS)


def check_triage(by_number: dict[int, dict]) -> list[str]:
    failures: list[str] = []
    lines = read_lines(TRIAGE_REL)
    if lines is None:
        return [f"{TRIAGE_REL} does not exist"]

    heading_failures, _heading_chapter = check_chapter_headings(lines, TRIAGE_REL, by_number)
    failures.extend(heading_failures)

    for i, line in enumerate(lines, 1):
        m = TRIAGE_ROW_RE.match(line)
        if not m:
            continue
        if chapter_for_line(i, _heading_chapter) is None:
            continue  # e.g. the `## Totals` disposition-count table, not a chapter row
        idx = m.group(1)
        cells = split_table_row(line)
        if len(cells) != 7:
            failures.append(
                f"{TRIAGE_REL}:{i}: row '{idx}' has {len(cells)} columns, expected 7 (malformed row)"
            )
            continue

        _idx, fragment, _idea, _drawn, role, disposition, _spec = cells

        if role not in ROLE_ENUM and role != "—":
            failures.append(f"{TRIAGE_REL}:{i}: row '{idx}' has unknown role '{role}'")

        disp_token = leading_token(disposition)
        if disp_token not in DISPOSITION_ENUM:
            failures.append(
                f"{TRIAGE_REL}:{i}: row '{idx}' has unknown disposition '{disposition}' "
                f"(leading token '{disp_token}')"
            )

        frag = SHARED_SUFFIX_RE.sub("", fragment).strip()
        if frag in ("—", "-", ""):
            continue
        if disp_token in ("keep", "restyle") and not fragment_exists(frag):
            failures.append(
                f"{TRIAGE_REL}:{i}: row '{idx}' disposition '{disp_token}' requires fragment "
                f"'{frag}.tex' to exist under {', '.join(FIGURE_DIRS)}, but it does not"
            )

    return failures


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    global REPO_ROOT
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true", help="print per-check pass/fail even when clean")
    parser.add_argument("--repo-root", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.repo_root:
        REPO_ROOT = os.path.abspath(args.repo_root)

    try:
        textbook = load_textbook()
    except (OSError, json.JSONDecodeError) as e:
        print(f"FATAL: could not read {TEXTBOOK_REL}: {e}", file=sys.stderr)
        return 1
    by_number = chapters_by_number(textbook)

    checks = [
        ("FIGURE-REGISTER.md", check_register(by_number)),
        ("FIGURE-TRIAGE.md", check_triage(by_number)),
    ]

    all_failures: list[str] = []
    for name, failures in checks:
        if args.verbose or failures:
            print("=" * 78)
            print(f"CHECK {name}: {len(failures)} failure(s)")
            print("=" * 78)
            for f in failures:
                print(f"  {f}")
            if failures:
                print()
        all_failures.extend(failures)

    print("=" * 78)
    print(f"SUMMARY: {len(all_failures)} total failure(s)")
    print("=" * 78)

    return 1 if all_failures else 0


if __name__ == "__main__":
    sys.exit(main())
