#!/usr/bin/env python3
"""check_critique_ledger.py -- consistency checker for the Harbor coordination
papers' critique ledger.

Background
----------
docs/harbor-research/CRITIQUE-LEDGER.md is the human-readable inventory of
every actionable item raised in the review memoranda on the Harbor
coordination papers (one Markdown table per source document, plus a
cross-source "duplicates and overlaps" list). docs/harbor-research/
critique-ledger.json is the same rows, machine-readable, so a later tool can
consume them without scraping Markdown. The two files are meant to be kept in
exact lockstep by hand as rows are added or their `Status` cell is filled in;
this script is the guard against them drifting apart.

Checks
------
  1. Every id (`#` column) that appears in the Markdown tables appears in the
     JSON array, and vice versa -- no row exists in only one of the two
     files.
  2. Within each file, no id is duplicated.
  3. Every `Status` cell (Markdown table cell and JSON `"Status"` field) is
     well-formed: empty, or one of
       DONE <sha-or-PR>
       IN-WAVE-<n>
       DECLINED -- <reason>
     (an em/en dash or a plain double hyphen is accepted before <reason>).
  4. For every id present in both files, the two files agree on `Status`
     verbatim -- if the author updates one and forgets the other, this is
     exactly the drift the tool exists to catch.

Stdlib only, offline, no network access.

Usage:
    python3 scripts/harbor-research/check_critique_ledger.py [--verbose]

Exit status: 0 if every check passes; 1 otherwise, with every failure
printed (not just the first).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MD_PATH = REPO_ROOT / "docs" / "harbor-research" / "CRITIQUE-LEDGER.md"
JSON_PATH = REPO_ROOT / "docs" / "harbor-research" / "critique-ledger.json"

ID_RE = re.compile(r"^[A-Z]{2,4}-\d{2,4}$")

# A Status cell is empty, or matches one of these three shapes.
STATUS_RE = re.compile(
    r"^(?:"
    r"DONE \S.*"                        # DONE <sha-or-PR> (at least one non-space token after)
    r"|IN-WAVE-\d+"                     # IN-WAVE-<n>
    r"|DECLINED\s*(?:--|-|—|–)\s*\S.*"  # DECLINED -- <reason> (--, -, em/en dash)
    r")$"
)


def unescape_cell(cell: str) -> str:
    """Undo the Markdown-table escaping applied when the cell was written:
    a literal backslash-pipe becomes a pipe, a literal double-backslash
    becomes one backslash. Order matters (pipe-unescape first)."""
    cell = cell.strip()
    # Temporarily protect an escaped backslash so it isn't mistaken for
    # part of an escaped pipe, then restore it.
    cell = cell.replace("\\\\", "\x00")
    cell = cell.replace("\\|", "|")
    cell = cell.replace("\x00", "\\")
    return cell


def split_row(line: str) -> list[str] | None:
    """Split one Markdown table row into its cell strings, respecting
    backslash-escaped pipes. Returns None if `line` is not a table row."""
    line = line.rstrip("\n")
    if not line.startswith("|"):
        return None
    body = line[1:]
    if body.endswith("|"):
        body = body[:-1]
    cells: list[str] = []
    current = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body) and body[i + 1] in ("|", "\\"):
            current.append(ch)
            current.append(body[i + 1])
            i += 2
            continue
        if ch == "|":
            cells.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    cells.append("".join(current))
    return [unescape_cell(c) for c in cells]


def parse_markdown_rows(text: str) -> dict[str, str]:
    """Returns {id: status} for every data row found in any Markdown table
    in the file (header and separator rows, and any row whose first cell is
    not a recognizable ledger id -- e.g. the 'Cluster' overlaps table -- are
    skipped)."""
    rows: dict[str, list[str]] = {}
    dupes: list[str] = []
    for line in text.splitlines():
        cells = split_row(line)
        if not cells or len(cells) < 2:
            continue
        first = cells[0].strip()
        if not ID_RE.match(first):
            continue
        if len(cells) < 7:
            raise SystemExit(
                f"Markdown row for {first!r} has {len(cells)} cells, expected 8: {line!r}"
            )
        status = cells[6]
        if first in rows:
            dupes.append(first)
        rows[first] = status
    if dupes:
        raise SystemExit(f"Duplicate id(s) in {MD_PATH}: {sorted(set(dupes))}")
    return {k: v for k, v in rows.items()}


def parse_json_rows(data: list[dict]) -> dict[str, str]:
    rows: dict[str, str] = {}
    dupes: list[str] = []
    for i, obj in enumerate(data):
        if "#" not in obj:
            raise SystemExit(f"{JSON_PATH}: array element {i} has no '#' key: {obj!r}")
        rid = obj["#"]
        if not ID_RE.match(rid):
            raise SystemExit(f"{JSON_PATH}: malformed id {rid!r} at element {i}")
        if "Status" not in obj:
            raise SystemExit(f"{JSON_PATH}: row {rid} has no 'Status' key")
        if rid in rows:
            dupes.append(rid)
        rows[rid] = obj["Status"]
    if dupes:
        raise SystemExit(f"Duplicate id(s) in {JSON_PATH}: {sorted(set(dupes))}")
    return rows


def check_status(rid: str, status: str, source: str, errors: list[str]) -> None:
    if status == "" or STATUS_RE.match(status):
        return
    errors.append(
        f"  [BAD STATUS] {source} row {rid}: {status!r} is not empty, "
        f"'DONE <sha-or-PR>', 'IN-WAVE-<n>', or 'DECLINED -- <reason>'"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true", help="print every id checked")
    args = parser.parse_args()

    if not MD_PATH.exists():
        print(f"[MISSING FILE] {MD_PATH}")
        return 1
    if not JSON_PATH.exists():
        print(f"[MISSING FILE] {JSON_PATH}")
        return 1

    md_rows = parse_markdown_rows(MD_PATH.read_text(encoding="utf-8"))
    try:
        json_data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"[INVALID JSON] {JSON_PATH}: {exc}")
        return 1
    if not isinstance(json_data, list):
        print(f"[INVALID JSON] {JSON_PATH}: top level must be an array, got {type(json_data).__name__}")
        return 1
    json_rows = parse_json_rows(json_data)

    errors: list[str] = []

    md_only = sorted(set(md_rows) - set(json_rows))
    json_only = sorted(set(json_rows) - set(md_rows))
    if md_only:
        errors.append(f"  [MD-ONLY] ids in {MD_PATH.name} but not {JSON_PATH.name}: {md_only}")
    if json_only:
        errors.append(f"  [JSON-ONLY] ids in {JSON_PATH.name} but not {MD_PATH.name}: {json_only}")

    for rid, status in sorted(md_rows.items()):
        check_status(rid, status, MD_PATH.name, errors)
    for rid, status in sorted(json_rows.items()):
        check_status(rid, status, JSON_PATH.name, errors)

    mismatched = []
    for rid in sorted(set(md_rows) & set(json_rows)):
        if md_rows[rid] != json_rows[rid]:
            mismatched.append(rid)
    if mismatched:
        errors.append(
            f"  [STATUS DRIFT] {len(mismatched)} row(s) have a different Status in "
            f"{MD_PATH.name} vs {JSON_PATH.name}: {mismatched}"
        )

    if args.verbose:
        print(f"Checked {len(md_rows)} Markdown rows and {len(json_rows)} JSON rows.")
        by_prefix: dict[str, int] = {}
        for rid in md_rows:
            by_prefix[rid.rsplit("-", 1)[0]] = by_prefix.get(rid.rsplit("-", 1)[0], 0) + 1
        for prefix in sorted(by_prefix):
            print(f"  {prefix}: {by_prefix[prefix]}")

    if errors:
        print(f"FAIL -- {len(errors)} problem(s) found:")
        for line in errors:
            print(line)
        return 1

    print(f"OK -- {len(md_rows)} ids, Markdown and JSON agree, all Status cells well-formed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
