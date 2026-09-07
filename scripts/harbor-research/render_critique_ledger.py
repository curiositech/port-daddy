#!/usr/bin/env python3
"""render_critique_ledger.py -- regenerate CRITIQUE-LEDGER.md's table rows from
critique-ledger.json.

Background
----------
docs/harbor-research/CRITIQUE-LEDGER.md and docs/harbor-research/
critique-ledger.json hold the same 759 rows in two forms (see the Markdown
file's own header for the id scheme and Status vocabulary). Everything in the
Markdown file that is *not* a data row -- the intro, each source document's
"## " heading and any prose under it, the seven table headers/separators, and
the closing "Duplicates and overlaps across sources" section -- lives only in
the Markdown file; the JSON has no place to keep it. So this renderer does not
generate the file from scratch: it re-reads the Markdown file as a template,
and for every line that is a data row (first cell matches a ledger id) it
substitutes a freshly rendered row built from that id's current JSON object,
leaving every other line byte-identical. Row order therefore always matches
the template's order, never the JSON array's order.

This makes the script idempotent and safe to run after only touching `Status`
and/or `Notes` in the JSON (the intended use), and also the reason it can be
verified byte-for-byte against a checkout where nothing has changed yet: feed
it a JSON exactly matching the current Markdown and the output must be
identical to the input.

Usage:
    python3 scripts/harbor-research/render_critique_ledger.py [--check]

Without --check, overwrites CRITIQUE-LEDGER.md with the regenerated content.
With --check, prints a unified diff (if any) against the current file and
exits 1 if the file is stale, 0 if it already matches.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MD_PATH = REPO_ROOT / "docs" / "harbor-research" / "CRITIQUE-LEDGER.md"
JSON_PATH = REPO_ROOT / "docs" / "harbor-research" / "critique-ledger.json"

ID_RE = re.compile(r"^[A-Z]{2,4}-\d{2,4}$")
COLUMNS = ["#", "Section / page", "Kind", "Item", "Targets", "Prior adjudication", "Status", "Notes"]


def escape_cell(value: str) -> str:
    """Inverse of check_critique_ledger.py's unescape_cell: a literal
    backslash becomes two, then a literal pipe becomes backslash-pipe (order
    matters, and is the reverse of the unescape order)."""
    return value.replace("\\", "\\\\").replace("|", "\\|")


def render_row(obj: dict) -> str:
    cells = [escape_cell(str(obj.get(col, ""))) for col in COLUMNS]
    return "|" + "".join(f" {c} |" for c in cells)


def row_id(line: str) -> str | None:
    if not line.startswith("|"):
        return None
    first = line[1:].split("|", 1)[0].strip()
    return first if ID_RE.match(first) else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="diff instead of writing; exit 1 if stale")
    args = parser.parse_args()

    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    by_id = {}
    for obj in data:
        rid = obj["#"]
        if rid in by_id:
            raise SystemExit(f"Duplicate id in {JSON_PATH}: {rid}")
        by_id[rid] = obj

    template = MD_PATH.read_text(encoding="utf-8")
    lines = template.split("\n")
    out_lines = []
    seen = set()
    for line in lines:
        rid = row_id(line)
        if rid is None:
            out_lines.append(line)
            continue
        if rid not in by_id:
            raise SystemExit(f"Row {rid} appears in {MD_PATH.name} template but not in {JSON_PATH.name}")
        seen.add(rid)
        out_lines.append(render_row(by_id[rid]))

    missing = set(by_id) - seen
    if missing:
        raise SystemExit(
            f"{len(missing)} id(s) in {JSON_PATH.name} do not appear as a row in the "
            f"{MD_PATH.name} template, so they have nowhere to render to: {sorted(missing)[:10]}..."
        )

    rendered = "\n".join(out_lines)

    if args.check:
        current = template
        if rendered == current:
            print(f"OK -- {MD_PATH} already matches {JSON_PATH.name}.")
            return 0
        diff = difflib.unified_diff(
            current.splitlines(keepends=True),
            rendered.splitlines(keepends=True),
            fromfile=str(MD_PATH),
            tofile=f"{MD_PATH} (regenerated)",
        )
        sys.stdout.writelines(diff)
        return 1

    MD_PATH.write_text(rendered, encoding="utf-8")
    print(f"Wrote {MD_PATH} ({len(by_id)} rows).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
