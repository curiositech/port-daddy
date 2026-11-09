#!/usr/bin/env python3
"""check_corrections.py -- does the rendered Book print what the corrections
ledger says it now prints?

A correction is made in a chapter source, but a reader only sees the page.
A fix can land in a branch the build never takes, in a figure the Book no
longer inputs, or in one of four retellings while the other three keep the
old text. Grep over the source cannot tell those apart; the PDF can.

book/corrections.yaml holds one row per correction (id, item, file, before,
after, source). This script extracts the text of a built PDF with PyMuPDF
and fails if any row's `before` string still prints or its `after` string
does not, naming the row and the page.

Both the page text and the ledger strings are normalised the same way
before they are compared:

  * whitespace and line breaks fold to one space;
  * a word hyphenated across a line end is rejoined ("coordi- / nation"),
    and, separately, joined with its hyphen kept, because a compound word
    broken at its own hyphen ("single- / writer") must still match;
  * ligatures and other compatibility forms expand (NFKC: the fi ligature
    becomes "fi", a math-italic x becomes "x", a no-break space a space);
  * smart quotes become ASCII quotes and every dash becomes "-".

The text is read three ways: in the PDF's own content-stream order; down
the body column alone, page after page, without the running head and foot,
so neither a margin note anchored mid-paragraph nor a page turn splits a
phrase; and down the margin column alone. A `before` string survives if it
is found in ANY reading, and an `after` string is present if it is found in
ANY: the strict reading for what must be gone, the lenient one for what
must be there. A `before` found
only inside an occurrence of its own row's `after` (a fix that only adds
words) does not count as surviving.

Usage:
    python3 scripts/harbor-research/check_corrections.py BOOK.pdf
    python3 scripts/harbor-research/check_corrections.py BOOK.pdf --corrections PATH
    python3 scripts/harbor-research/check_corrections.py BOOK.pdf --json

Exit 0 when every row holds (an empty ledger holds trivially and says so),
1 when any row fails on the page, 2 when the ledger or the PDF cannot be
read. run_pdf_checks.py runs this on every PDF it checks.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LEDGER = REPO_ROOT / "book" / "corrections.yaml"

FIELDS = ("id", "item", "file", "before", "after", "source")

# A ledger string that carries TeX can never match extracted text. For an
# `after` that is a loud failure; for a `before` it is a silent pass -- the
# old wording "is gone" because the needle was never findable -- which is the
# fail-open this check exists to prevent. So TeX syntax is a schema error.
TEX_SYNTAX = re.compile(r"[\\{}$~]")

# Characters that end a line in the middle of a hyphenated word. U+00AD (soft
# hyphen) is handled separately: it is never a real hyphen, so it is always
# dropped.
LINE_HYPHENS = "-‐‑"
SOFT_HYPHEN = "­"
# Every dash folds to one ASCII hyphen, runs included ("--" written in the
# ledger for an en dash, "—" printed for an em dash).
DASHES = "-‐‑‒–—―−﹘﹣－"
QUOTES = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
    "«": '"', "»": '"',
}
ZERO_WIDTH = {"​", "‌", "‍", "⁠", "﻿"}
# After the break: optional horizontal space, the newline, optional space,
# then a letter. Digits are excluded: "pp. 12-\n14" is a range, not a word.
BREAK_THEN_LETTER = re.compile(r"[ \t]*\n\s*(?=[^\W\d_])")


class LedgerError(Exception):
    """The corrections ledger cannot be checked as written."""


# ---------------------------------------------------------------------------
# The ledger
# ---------------------------------------------------------------------------


def load_rows(path: Path, repo_root: Path = REPO_ROOT) -> list[dict]:
    """Read and validate the ledger. Every problem is collected, so one run
    names all of them rather than the first."""
    try:
        import yaml
    except ImportError as error:  # pragma: no cover - environment defect
        raise LedgerError(
            "PyYAML is required: pip install -r scripts/harbor-research/requirements-pdf.txt"
        ) from error
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise LedgerError(f"cannot read {path}: {error}") from error
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise LedgerError(f"{path}: not valid YAML: {error}") from error
    if data is None:
        return []  # the header comment alone: no rows yet
    if not isinstance(data, list):
        raise LedgerError(f"{path}: rows must be a top-level YAML sequence (- id: ...)")

    problems: list[str] = []
    seen: dict[str, int] = {}
    rows: list[dict] = []
    for index, raw in enumerate(data, start=1):
        where = f"{path.name} row {index}"
        if not isinstance(raw, dict):
            problems.append(f"{where}: a row must be a mapping of {', '.join(FIELDS)}")
            continue
        row_id = raw.get("id")
        if isinstance(row_id, str) and row_id.strip():
            where = f"{path.name} row {index} ({row_id})"
        unknown = sorted(set(raw) - set(FIELDS))
        if unknown:
            problems.append(f"{where}: unknown field(s) {', '.join(map(str, unknown))}")
        row: dict = {}
        for key in FIELDS:
            value = raw.get(key)
            if key in ("before", "after") and value is None:
                value = ""
            if not isinstance(value, str):
                problems.append(f"{where}: {key} must be a string")
                value = ""
            row[key] = value.strip()
        for key in ("id", "item", "file", "source"):
            if raw.get(key) is not None and isinstance(raw.get(key), str) and not row[key]:
                problems.append(f"{where}: {key} must not be empty")
        if not row["before"] and not row["after"]:
            problems.append(f"{where}: before and after cannot both be empty")
        if row["before"] and row["before"] == row["after"]:
            problems.append(f"{where}: before and after are the same string")
        for key in ("before", "after"):
            if TEX_SYNTAX.search(row[key]):
                problems.append(
                    f"{where}: {key} contains TeX syntax ({row[key]!r}); write the words as they print"
                )
        if row["file"]:
            target = (repo_root / row["file"]).resolve()
            try:
                target.relative_to(repo_root.resolve())
            except ValueError:
                problems.append(f"{where}: file {row['file']} is outside the repository")
            else:
                if not target.is_file():
                    problems.append(f"{where}: file {row['file']} does not exist")
        if row["id"]:
            if row["id"] in seen:
                problems.append(f"{where}: duplicate id (first used by row {seen[row['id']]})")
            else:
                seen[row["id"]] = index
        rows.append(row)
    if problems:
        raise LedgerError("\n".join(problems))
    return rows


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


def _fold(ch: str) -> str:
    if ch in ZERO_WIDTH:
        return ""
    if ch in QUOTES:
        return QUOTES[ch]
    if ch in DASHES:
        return "-"
    return unicodedata.normalize("NFKC", ch)


def normalise(raw: str, keep_hyphen: bool = False) -> tuple[str, list[int]]:
    """Fold `raw` as the module docstring describes. Returns the folded text
    and, for each folded character, the index in `raw` it came from, so a
    match can be traced back to its page.

    keep_hyphen=False rejoins a line-end hyphenation without the hyphen
    ("coordi-\\nnation" -> "coordination"); True keeps it ("single-writer").
    """
    out: list[str] = []
    origin: list[int] = []

    def emit(text: str, at: int) -> None:
        for c in text:
            if c.isspace():
                if not out or out[-1] == " ":
                    continue
                c = " "
            elif c == "-" and out and out[-1] == "-":
                continue  # a run of dashes is one dash
            out.append(c)
            origin.append(at)

    i = 0
    n = len(raw)
    while i < n:
        ch = raw[i]
        if ch == SOFT_HYPHEN:
            # Never a real hyphen. At a line end it also swallows the break.
            m = BREAK_THEN_LETTER.match(raw, i + 1)
            i = m.end() if m else i + 1
            continue
        if ch in LINE_HYPHENS and out and out[-1].isalpha():
            m = BREAK_THEN_LETTER.match(raw, i + 1)
            if m:
                if keep_hyphen:
                    emit("-", i)
                i = m.end()
                continue
        if ch in "`'" and i + 1 < n and raw[i + 1] == ch:
            # TeX-style `` and '' written in the ledger, or left in a PDF by a
            # font without curly quotes: one double quote.
            emit('"', i)
            i += 2
            continue
        emit(_fold(ch), i)
        i += 1
    while out and out[-1] == " ":
        out.pop()
        origin.pop()
    return "".join(out), origin


def needle(text: str) -> str:
    return normalise(text, keep_hyphen=True)[0]


# ---------------------------------------------------------------------------
# The rendered text
# ---------------------------------------------------------------------------


@dataclass
class Page:
    number: int  # 1-based physical page in the PDF
    label: str  # the printed folio from /PageLabels, or "" when there is none
    stream: str  # content-stream order
    body: str  # the body column, top to bottom, without running head and foot
    margin: str  # the margin column, top to bottom

    def where(self) -> str:
        if self.label and self.label != str(self.number):
            return f"p{self.number} (folio {self.label})"
        return f"p{self.number}"


@dataclass
class Reading:
    """One normalised reading of the whole document, with a map from each
    character back to its page."""

    name: str
    text: str
    page_index: list[int]  # parallel to text: index into the page list

    def pages_at(self, start: int, end: int) -> list[int]:
        return sorted(set(self.page_index[start:end]))


# The running head and foot sit outside the text block: in the Book, above
# 8.5% and below 90.5% of the page height. A line wholly inside these bands
# is page furniture, and leaving it in the column readings would put a
# running foot in the middle of every sentence that turns a page.
HEAD_BAND, FOOT_BAND = 0.07, 0.92


def column_texts(page) -> tuple[str, str]:
    """A page's body column and its margin column, each top to bottom,
    without the running head and foot.

    Lines, not blocks: MuPDF can fold a margin note into the paragraph block
    it sits beside. The body column is the horizontal span of the page's
    widest line; a line whose centre lies outside that span is margin
    matter. This needs no knowledge of the Book's column geometry, so it
    reads a fixture page the same way it reads a 7 x 10 in spread."""
    height = page.rect.height
    lines = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            text = "".join(span["text"] for span in line["spans"])
            x0, y0, x1, y1 = line["bbox"]
            if not text.strip() or y1 < HEAD_BAND * height or y0 > FOOT_BAND * height:
                continue
            lines.append(((x0, y0, x1, y1), text))
    if not lines:
        return "", ""
    (left, _, right, _), _ = max(lines, key=lambda item: item[0][2] - item[0][0])
    body, margin = [], []
    for bbox, text in lines:
        centre = (bbox[0] + bbox[2]) / 2
        (body if left - 1 <= centre <= right + 1 else margin).append((bbox, text))
    order = lambda item: (round(item[0][1]), item[0][0])  # noqa: E731
    return ("\n".join(text for _, text in sorted(body, key=order)),
            "\n".join(text for _, text in sorted(margin, key=order)))


def read_pdf(path: Path) -> list[Page]:
    import pymupdf

    try:
        document = pymupdf.open(path)
    except Exception as error:  # pymupdf raises its own FileDataError types
        raise LedgerError(f"cannot open {path}: {error}") from error
    pages = []
    with document:
        for index, page in enumerate(document):
            try:
                label = page.get_label() or ""
            except Exception:  # a malformed /PageLabels tree is not this check's finding
                label = ""
            body, margin = column_texts(page)
            pages.append(Page(index + 1, label, page.get_text("text"), body, margin))
    return pages


def readings(pages: list[Page]) -> list[Reading]:
    """Six readings: the content stream, the body column and the margin
    column, each with line-end hyphens rejoined and kept. Pages join with a
    line break, so in the body reading a phrase -- or a word hyphenated --
    across a page turn still reads as one."""
    result = []
    for order in ("stream", "body", "margin"):
        parts = [getattr(page, order) for page in pages]
        starts, offset = [], 0
        for part in parts:
            starts.append(offset)
            offset += len(part) + 1  # the joining line break
        raw = "\n".join(parts)
        for keep in (False, True):
            text, origin = normalise(raw, keep_hyphen=keep)
            page_index = []
            cursor = 0
            for at in origin:
                while cursor + 1 < len(starts) and at >= starts[cursor + 1]:
                    cursor += 1
                page_index.append(cursor)
            label = f"{order}, hyphens {'kept' if keep else 'rejoined'}"
            result.append(Reading(label, text, page_index))
    return result


# ---------------------------------------------------------------------------
# The check
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    row: dict
    kind: str  # "before survives" | "after missing"
    text: str
    pages: list[int] = field(default_factory=list)  # 0-based page indices
    nearest: str = ""  # for a missing after: the longest prefix found

    def as_json(self, pages: list[Page]) -> dict:
        return {
            "id": self.row["id"],
            "item": self.row["item"],
            "file": self.row["file"],
            "source": self.row["source"],
            "kind": self.kind,
            "text": self.text,
            "pages": [pages[i].number for i in self.pages],
            "folios": [pages[i].label for i in self.pages],
            "nearest": self.nearest,
        }


def occurrences(haystack: str, pattern: str) -> list[tuple[int, int]]:
    spans, start = [], 0
    while pattern:
        at = haystack.find(pattern, start)
        if at < 0:
            break
        spans.append((at, at + len(pattern)))
        start = at + 1
    return spans


def nearest_prefix(reading: Reading, target: str) -> tuple[str, list[int]]:
    """The longest word-boundary prefix of `target` the reading contains,
    for telling a reader where a missing phrase nearly printed."""
    words = target.split(" ")
    for count in range(len(words) - 1, 0, -1):
        prefix = " ".join(words[:count])
        if len(prefix) < 4:
            break
        found = occurrences(reading.text, prefix)
        if found:
            return prefix, reading.pages_at(found[0][0], found[0][1])
    return "", []


def check(rows: list[dict], texts: list[Reading]) -> list[Finding]:
    findings: list[Finding] = []
    for row in rows:
        before, after = needle(row["before"]), needle(row["after"])
        if before:
            survivors: set[int] = set()
            for reading in texts:
                covered = occurrences(reading.text, after) if after else []
                for start, end in occurrences(reading.text, before):
                    if any(a <= start and end <= b for a, b in covered):
                        continue
                    survivors.update(reading.pages_at(start, end))
            if survivors:
                findings.append(Finding(row, "before survives", row["before"], sorted(survivors)))
        if after and not any(after in reading.text for reading in texts):
            best, pages = "", []
            for reading in texts:
                prefix, where = nearest_prefix(reading, after)
                if len(prefix) > len(best):
                    best, pages = prefix, where
            findings.append(Finding(row, "after missing", row["after"], pages, best))
    return findings


def report(findings: list[Finding], rows: list[dict], pages: list[Page], pdf: Path) -> str:
    if not rows:
        return (f"check_corrections: {pdf.name}\n"
                "-- 0 rows in the corrections ledger; nothing to check")
    lines = [f"check_corrections: {len(rows)} row(s) against {pdf.name} ({len(pages)} pages)"]
    failing = sorted({f.row["id"] for f in findings})
    lines.append(f"-- {len(failing)} correction row(s) fail on the rendered page" if failing
                 else "-- 0 correction rows fail on the rendered page")
    for f in findings:
        row = f.row
        tail = f"-- {row['item']}; {row['file']}; source: {row['source']}"
        if f.kind == "before survives":
            for index in f.pages:
                lines.append(f"{pages[index].where()} {row['id']} before survives: {f.text!r} {tail}")
        else:
            if f.nearest and f.pages:
                where = ", ".join(pages[i].where() for i in f.pages)
                lines.append(
                    f"{pages[f.pages[0]].where()} {row['id']} after missing: {f.text!r}; "
                    f"nearest print is {f.nearest!r} on {where} {tail}"
                )
            else:
                lines.append(f"p? {row['id']} after missing: {f.text!r}; on no page {tail}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdf", type=Path, help="the built Book PDF")
    parser.add_argument("--corrections", type=Path, default=DEFAULT_LEDGER,
                        help="the ledger (default: book/corrections.yaml)")
    parser.add_argument("--json", action="store_true", help="print findings as JSON")
    args = parser.parse_args(argv)

    try:
        rows = load_rows(args.corrections)
        if not args.pdf.is_file():
            raise LedgerError(f"no PDF at {args.pdf}")
        pages = read_pdf(args.pdf) if rows or args.json else []
    except LedgerError as error:
        print(f"check_corrections: {error}", file=sys.stderr)
        return 2

    findings = check(rows, readings(pages)) if rows else []
    if args.json:
        print(json.dumps({
            "pdf": str(args.pdf),
            "pages": len(pages),
            "rows": len(rows),
            "findings": [f.as_json(pages) for f in findings],
        }, indent=2))
    else:
        print(report(findings, rows, pages, args.pdf))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
