#!/usr/bin/env python3
"""promote_cites.py -- rewrite \\cite{...} to \\pdcite{...} at the point of use.

\\pdcite{key[,key...]} (figures/pd-pedagogy.tex) emits the normal \\cite{...}
plus, in the Book only, a margin short-form note per key; in a standalone
chapter it is exactly \\cite. This script promotes every eligible \\cite{...}
in the eight Book chapters (whitepaper/textbook.json's chapters[].source) to
\\pdcite{...}, EXCEPT inside:

  - \\begin{thebibliography}...\\end{thebibliography} (the back matter itself
    never needs its own margin -- there is no margin there to speak of);
  - \\caption{...} (a figure/table caption has no margin column of its own
    at the point it is set; a margin note anchored to a caption's line would
    land beside the wrong content);
  - \\footnote{...} (a footnote is already a note -- a margin note about a
    citation used INSIDE a footnote has nowhere sensible to point);
  - a section-family heading's title argument (\\section, \\subsection,
    \\subsubsection, \\paragraph, \\subparagraph -- headings are not running
    prose with a margin line beside them);
  - \\pdmarginfigure{...}{...} and \\pdgloss{...}{...}'s own arguments (a
    margin note issued from inside another margin note's own content would
    double up two independent boxes at the same source line and risk them
    colliding on the page -- the same reasoning pd-pedagogy.tex documents for
    why \\pdgloss builds one combined \\marginnote rather than two).

A \\cite[note]{key} with an optional citation note (bracket argument) is also
left alone -- \\pdcite's signature is \\pdcite{key[,key...]}, with no room for
a citation-note argument, and the corpus has only one such use, not enough to
justify extending the macro's signature for.

Idempotent: a \\pdcite{...} already in the source is left as-is (the eligible-
region scan only ever matches \\cite, never \\pdcite).

Usage:
    python3 scripts/harbor-research/promote_cites.py [--check]

--check reports what WOULD change (same counts) without writing anything,
exiting 1 if any chapter has an eligible \\cite left unpromoted.

Reports, per chapter: cites promoted, and cites left alone (with why).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEXTBOOK_REL = "whitepaper/textbook.json"

CITE_RE = re.compile(r"\\cite(\[[^\]]*\])?\{([^}]*)\}")
HEADING_COMMANDS = ("section", "subsection", "subsubsection", "paragraph", "subparagraph")


def load_textbook() -> dict:
    path = os.path.join(REPO_ROOT, TEXTBOOK_REL)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def balanced_group_end(text: str, open_brace: int) -> int:
    """Index just past the matching close brace for the '{' at open_brace."""
    depth = 0
    i = open_brace
    n = len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


class UnterminatedBibliography(Exception):
    """A chapter opened a bibliography it never closed."""


def protected_spans(text: str, label: str = "<source>") -> list[tuple[int, int]]:
    """Every (start, end) span \\cite must not be promoted inside."""
    spans: list[tuple[int, int]] = []

    for m in re.finditer(r"\\begin\{thebibliography\}", text):
        end_m = re.search(r"\\end\{thebibliography\}", text[m.start():])
        # An unterminated bibliography used to protect everything after it,
        # which meant a chapter with a typo'd \end silently promoted nothing
        # from that point to its last line and still reported success. The
        # file is not valid TeX in that state, so say so rather than quietly
        # skipping most of the chapter.
        if end_m is None:
            line = text.count("\n", 0, m.start()) + 1
            raise UnterminatedBibliography(
                f"{label}:{line}: \\begin{{thebibliography}} is never closed; "
                f"fix the source before promoting citations")
        spans.append((m.start(), m.start() + end_m.end()))

    for name in ("caption", "footnote", *HEADING_COMMANDS):
        for m in re.finditer(r"\\" + name + r"\*?\s*(\[[^\]]*\])?\{", text):
            brace = m.end() - 1
            spans.append((m.start(), balanced_group_end(text, brace)))

    for name in ("pdmarginfigure", "pdgloss"):
        for m in re.finditer(r"\\" + re.escape(name) + r"\{", text):
            first_brace = m.end() - 1
            first_end = balanced_group_end(text, first_brace)
            # both arguments -- find the second brace group right after the first
            rest = text[first_end:]
            m2 = re.match(r"\s*\{", rest)
            if m2:
                second_end = first_end + balanced_group_end(rest, m2.end() - 1)
            else:
                second_end = first_end
            spans.append((m.start(), second_end))

    spans.sort()
    return spans


def in_any_span(pos: int, spans: list[tuple[int, int]]) -> bool:
    for start, end in spans:
        if start <= pos < end:
            return True
        if pos < start:
            break
    return False


def promote(text: str, label: str = "<source>") -> tuple[str, int, int, int]:
    """Returns (new_text, promoted_count, skipped_protected_count,
    skipped_optional_arg_count)."""
    spans = protected_spans(text, label)
    out = []
    last = 0
    promoted = 0
    skipped_protected = 0
    skipped_optional = 0
    for m in CITE_RE.finditer(text):
        if in_any_span(m.start(), spans):
            skipped_protected += 1
            continue
        if m.group(1):  # \cite[note]{...} -- no room in \pdcite's signature
            skipped_optional += 1
            continue
        out.append(text[last : m.start()])
        out.append(f"\\pdcite{{{m.group(2)}}}")
        last = m.end()
        promoted += 1
    out.append(text[last:])
    return "".join(out), promoted, skipped_protected, skipped_optional


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="report only, write nothing; exit 1 if anything would change")
    args = parser.parse_args()

    textbook = load_textbook()
    total_promoted = 0
    total_protected = 0
    total_optional = 0
    any_change = False

    for chapter in textbook["chapters"]:
        path = os.path.join(REPO_ROOT, chapter["source"])
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        try:
            new_text, promoted, skipped_protected, skipped_optional = promote(text, chapter["source"])
        except UnterminatedBibliography as err:
            print(f"ERROR {err}", file=sys.stderr)
            return 1
        total_promoted += promoted
        total_protected += skipped_protected
        total_optional += skipped_optional
        changed = new_text != text
        any_change = any_change or changed
        print(
            f"{chapter['source']}: {promoted} promoted, "
            f"{skipped_protected} left in a protected region, "
            f"{skipped_optional} left (optional citation note)"
            + ("" if not args.check else f" [{'would change' if changed else 'no change'}]")
        )
        if not args.check and changed:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(new_text)

    print(
        f"\nTOTAL: {total_promoted} promoted, {total_protected} left in a protected region, "
        f"{total_optional} left (optional citation note) across {len(textbook['chapters'])} chapter(s)"
    )

    if args.check:
        return 1 if any_change else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
