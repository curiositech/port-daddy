#!/usr/bin/env python3
"""No macro name is defined twice across the Book's chapter corpus.

WHAT THIS PREVENTS

The Book is assembled by scripts/generate-mega-whitepaper.mjs, which keeps
only what lies between \\begin{document} and \\end{document}. A chapter's
preamble is DISCARDED at collation. So a \\newcommand in a chapter preamble
governs that chapter's standalone PDF and nothing else, while the same call
site in the Book resolves against whatever the Book's preamble says.

Two definitions of one name therefore produce two different renderings of the
same source line, and no build fails. That is not hypothetical:

  * \\Built printed "built" in legible-swarm-whitepaper.pdf and "implemented"
    at the same call sites in the Book. The chapter's own status legend
    explained a word its Book tables never printed, and the drift had been
    noticed once and worked around by widening a column rather than fixed.
  * \\Designed printed "designed" standalone and "specified" in the Book.
  * \\Vision ("vision") and \\Proposed ("proposed") were two axes -- how much
    of a mechanism exists, and whether a result is proved -- that collapsed
    onto the single word "proposed" in the Book, eight lines apart in one
    legend.
  * A chapter preamble redefining \\NotGuar to print "theorem" makes the
    standalone paper say "theorem" and the Book say "not guaranteed" at the
    same call site: the two ends of the honesty ledger, swapped.

A count-matching check would miss all of these, because the counts match. The
defect is that both definitions exist and disagree. So this check refuses the
SECOND DEFINITION ITSELF, whether or not the bodies happen to agree today --
agreement between two copies is a fact about this commit, not an invariant.

THE FIX IT ASKS FOR

Define the macro once, in a file both the Book preamble and the standalone
chapters \\input -- figures/pd-pedagogy.tex for the status vocabularies -- and
delete the chapter-local copies.

SCOPE

The chapter sources named by whitepaper/textbook.json, the Book's preamble,
and the shared figures/pd-*.tex they all \\input. The shared figures exist as
two byte-identical copies (one per source tree); only the canonical copy under
whitepaper/figures/ is scanned, since the twins' identity is asserted by
scripts/generate-mega-whitepaper.test.mjs.

Only \\newcommand is considered. \\renewcommand and \\def are deliberate
overrides of something already defined, and pd-pedagogy.tex uses \\long\\def at
\\AtBeginDocument time on purpose to replace the chapters' page-grammar
placeholders.

Usage:
  check_duplicate_macros.py              # fail on any unallowed duplicate
  check_duplicate_macros.py --list       # print every definition found
  check_duplicate_macros.py --allow NAME # tolerate one more name (repeatable)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TEXTBOOK_JSON = REPO_ROOT / "whitepaper" / "textbook.json"
BOOK_PREAMBLE = (
    REPO_ROOT
    / "website-v2"
    / "public"
    / "whitepaper"
    / "coordination-papers-mega-volume-preamble.tex"
)
SHARED_FIGURES_DIR = REPO_ROOT / "whitepaper" / "figures"

# Names allowed to carry more than one definition, each with the reason it is
# not the defect above. An entry here is a record that a duplicate is
# deliberate -- not a place to silence a new one.
ALLOWED: dict[str, str] = {
    # Per-chapter by design: each chapter declares its own key into
    # whitepaper/textbook.json, which figures/pd-textbook-map.tex reads.
    "pdchapterprefix": "per-chapter by design: each chapter's own textbook.json key",
    # Page-grammar placeholders. figures/pd-pedagogy.tex \long\def's each of
    # these at \AtBeginDocument time, AFTER every preamble has run, so the
    # chapter-local \newcommand is a fallback that the shared file then
    # replaces. The shared definition is the one that reaches the page in both
    # the Book and the standalone chapters.
    "pullquote": "page-grammar placeholder; pd-pedagogy.tex \\long\\def's it at \\AtBeginDocument",
    "keyidea": "page-grammar placeholder; pd-pedagogy.tex \\long\\def's it at \\AtBeginDocument",
    "pitfall": "page-grammar placeholder; pd-pedagogy.tex \\long\\def's it at \\AtBeginDocument",
    "scene": "page-grammar placeholder; pd-pedagogy.tex \\long\\def's it at \\AtBeginDocument",
    "xrefbox": "page-grammar placeholder; pd-pedagogy.tex \\long\\def's it at \\AtBeginDocument",
}

# \newcommand{\Name}  /  \newcommand\Name  /  \newcommand*{\Name}
NEWCOMMAND_RE = re.compile(r"\\newcommand\s*\*?\s*(?:\{\s*\\([A-Za-z@]+)\s*\}|\\([A-Za-z@]+))")


def strip_tex_comments(text: str) -> str:
    """Blank out %-comments, keeping line numbering and escaped \\% intact.

    Written the careful way on purpose. A throwaway version of this script
    that skipped it silently stopped scanning the Book preamble the moment a
    COMMENT there mentioned \\begin{document} -- and so reported a clean run
    over a file it had never read past line 248.
    """
    out = []
    for line in text.split("\n"):
        i, n = 0, len(line)
        cut = None
        while i < n:
            ch = line[i]
            if ch == "\\":
                i += 2  # an escaped character, \% included, is never a comment
                continue
            if ch == "%":
                cut = i
                break
            i += 1
        out.append(line if cut is None else line[:cut])
    return "\n".join(out)


def preamble_of(text: str) -> str:
    """The part of a document that runs before \\begin{document}.

    Comments are stripped first, so a commented-out or merely discussed
    \\begin{document} cannot truncate the scan.
    """
    stripped = strip_tex_comments(text)
    marker = stripped.find(r"\begin{document}")
    return stripped if marker < 0 else stripped[:marker]


def definition_body(text: str, start: int) -> str:
    """The brace-balanced body of the definition whose match began at `start`."""
    open_at = text.find("{", start)
    if open_at < 0:
        return ""
    depth, i = 0, open_at
    while i < len(text):
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return " ".join(text[open_at : i + 1].split())
        i += 1
    return " ".join(text[open_at:].split())


def scan(path: Path, whole_file: bool) -> list[tuple[str, int, str]]:
    raw = path.read_text(encoding="utf-8")
    region = strip_tex_comments(raw) if whole_file else preamble_of(raw)
    found = []
    for m in NEWCOMMAND_RE.finditer(region):
        name = m.group(1) or m.group(2)
        line = region[: m.start()].count("\n") + 1
        # \newcommand{\Name}[2]{body} -- skip the optional arg-count brackets.
        after = m.end()
        rest = region[after:]
        offset = len(rest) - len(rest.lstrip())
        cursor = after + offset
        while cursor < len(region) and region[cursor] == "[":
            close = region.find("]", cursor)
            if close < 0:
                break
            cursor = close + 1
            while cursor < len(region) and region[cursor] in " \t\n":
                cursor += 1
        found.append((name, line, definition_body(region, cursor)))
    return found


def corpus_files() -> list[tuple[Path, bool]]:
    """(path, scan_whole_file) for everything the Book is built from."""
    textbook = json.loads(TEXTBOOK_JSON.read_text(encoding="utf-8"))
    files: list[tuple[Path, bool]] = []
    for chapter in textbook["chapters"]:
        files.append((REPO_ROOT / chapter["source"], False))
    files.append((BOOK_PREAMBLE, True))
    # Shared includes: the canonical copy only. The website-v2 twin is
    # byte-identical (asserted by generate-mega-whitepaper.test.mjs), so
    # scanning both would report every shared macro as its own duplicate.
    for shared in sorted(SHARED_FIGURES_DIR.glob("pd-*.tex")):
        files.append((shared, True))
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--allow",
        action="append",
        default=[],
        metavar="NAME",
        help="tolerate a duplicate definition of NAME (repeatable)",
    )
    parser.add_argument("--list", action="store_true", help="print every definition found")
    args = parser.parse_args()

    allowed = dict(ALLOWED)
    for name in args.allow:
        allowed.setdefault(name.lstrip("\\"), "allowed on the command line")

    definitions: dict[str, list[tuple[str, int, str]]] = {}
    files = corpus_files()
    for path, whole in files:
        if not path.exists():
            print(f"error: {path.relative_to(REPO_ROOT)} is named by the corpus but missing")
            return 1
        rel = str(path.relative_to(REPO_ROOT))
        for name, line, body in scan(path, whole):
            definitions.setdefault(name, []).append((rel, line, body))

    if args.list:
        for name in sorted(definitions):
            for rel, line, body in definitions[name]:
                print(f"{name:18s} {rel}:{line}")

    offenders = {
        name: sites
        for name, sites in definitions.items()
        if len(sites) > 1 and name not in allowed
    }

    total = sum(len(v) for v in definitions.values())
    if not offenders:
        allowed_seen = sorted(n for n in definitions if len(definitions[n]) > 1)
        print(
            f"ok: {total} \\newcommand definitions across {len(files)} corpus files, "
            f"every name defined once"
            + (f" ({len(allowed_seen)} allowed duplicates: {', '.join(allowed_seen)})" if allowed_seen else "")
        )
        return 0

    print(
        f"error: {len(offenders)} macro name(s) are defined more than once in the "
        f"Book's chapter corpus.\n"
        f"A chapter preamble is discarded when the Book is assembled, so a second\n"
        f"definition changes what a call site prints in one edition and not the other.\n"
        f"Define the name once in a file both the Book preamble and the standalone\n"
        f"chapters \\input -- figures/pd-pedagogy.tex for the status vocabularies --\n"
        f"and delete the rest.\n"
    )
    for name in sorted(offenders):
        sites = offenders[name]
        bodies = {body for _, _, body in sites}
        verdict = (
            "THE BODIES DIFFER -- a call site can print one word in the Book "
            "and another in the standalone chapter"
            if len(bodies) > 1
            else "the bodies are identical today, but nothing keeps them in step"
        )
        print(f"  \\{name} -- defined {len(sites)} times; {verdict}:")
        for rel, line, body in sites:
            print(f"      {rel}:{line}")
            print(f"          {body}")
        print()
    print(
        "If a duplicate is deliberate, add it to ALLOWED in this file with the "
        "reason it is not the defect above."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
