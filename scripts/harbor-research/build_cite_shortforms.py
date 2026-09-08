#!/usr/bin/env python3
"""build_cite_shortforms.py -- generate the margin short-form table for \\pdcite.

\\pdcite{key} (figures/pd-pedagogy.tex) emits the normal \\cite{key} plus, in
the Book only, a small margin note: "Author Year" (or "Author & Author Year",
or "First et al. Year"), optionally followed by the first few words of the
title in italics when the whole note still fits one margin line. The macro
looks the short form up in a generated table, \\pdciteshort{key}{short form},
and falls back to the raw key when a key has no entry.

This script builds that table by parsing every \\bibitem in the eight Book
chapters' own \\begin{thebibliography} blocks (whitepaper/textbook.json's
chapters[].source). The bibliographies are hand-written prose, not BibTeX, so
parsing is defensive, not exhaustive:

  - the author line is the text before the entry's first \\newblock (or the
    whole entry, if it never uses \\newblock at all); it must look like a
    list of personal names (starts with a capital letter, contains no brace
    or backslash command) or the entry is UNPARSED;
  - the first surname is the text before the first comma or " and " in that
    author line;
  - two authors ("A and B", no comma) render "Surname & Surname"; three or
    more (Oxford-comma list, or an explicit "et al.") render "Surname et
    al."; one author renders "Surname";
  - the year is the first four-digit 19xx/20xx run anywhere in the entry;
  - the title is the text of the second \\newblock chunk (the first one after
    the author line), with a single fully-wrapping \\emph{...} or
    \\textit{...} stripped so the short form can re-italicize it itself.

An entry missing an author line, a year, or a title is UNPARSED: it is
printed to stderr so the lead can hand-fix the bibliography entry, and
\\pdcite falls back to the raw key for it (no table row is written).

Usage:
    python3 scripts/harbor-research/build_cite_shortforms.py [--check]

Writes (byte-identical) whitepaper/figures/pd-cite-shortforms.tex and
website-v2/public/whitepaper/figures/pd-cite-shortforms.tex.

--check regenerates in memory and fails (exit 1) if either committed copy is
stale, without writing anything -- for CI / a pre-push check.

Exit status: 0 on a normal write (even with some UNPARSED keys -- those are
reported, not fatal); 1 if --check finds drift or the JSON/tex it depends on
cannot be read.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEXTBOOK_REL = "whitepaper/textbook.json"

TARGETS = [
    "whitepaper/figures/pd-cite-shortforms.tex",
    "website-v2/public/whitepaper/figures/pd-cite-shortforms.tex",
]

BIBITEM_RE = re.compile(r"\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}")
THEBIB_RE = re.compile(r"\\begin\{thebibliography\}.*?\\end\{thebibliography\}", re.DOTALL)
# A publication year: 1400-2099, not immediately followed by a decimal point
# and more digits (an arXiv id like "1710.09437" or "1805.00899" contains a
# 4-digit run that looks exactly like a year otherwise).
YEAR_RE = re.compile(r"\b(1[4-9]\d{2}|20\d{2})\b(?!\.\d)")


DOI_OR_URL_RE = re.compile(r"\\url\{[^}]*\}|10\.\d{4,9}/\S+")
# A trailing parenthetical aside ("(With Green & Porter, Econometrica 1984.)")
# can carry a second, later date that is not the entry's own publication
# year; a single level of nesting is enough for this corpus.
PARENTHETICAL_RE = re.compile(r"\([^()]*\)")


def find_year(entry_text: str) -> str | None:
    """The publication year is conventionally the LAST remaining four-digit
    run in a hand-written entry once \\url{...}/DOI digits and any
    parenthetical aside are blanked out (author initials and page ranges
    precede the real year; a DOI prefix, an arXiv id, or a footnote-style
    aside citing a different, related work can otherwise look exactly like
    one, or supply a spurious later one)."""
    cleaned = DOI_OR_URL_RE.sub(" ", entry_text)
    cleaned = PARENTHETICAL_RE.sub(" ", cleaned)
    last = None
    for m in YEAR_RE.finditer(cleaned):
        last = m.group(0)
    if last is None:
        # The year lived only inside the stripped parenthetical -- rare, but
        # better than reporting no year at all when one is plainly present.
        for m in YEAR_RE.finditer(DOI_OR_URL_RE.sub(" ", entry_text)):
            last = m.group(0)
    return last
# A plausible personal-name author line: starts with a capital letter (LaTeX
# name markup -- \ (control space), ~ (tie), \'{e}-style accents, \L{}-style
# special letters -- is expected and allowed); a handful of markup commands
# that mean this is a TITLE or a website standing in for an author, not a
# name, are rejected explicitly instead.
NAME_LINE_RE = re.compile(r"^[A-Z]")
NAME_MARKUP_BLOCKLIST_RE = re.compile(
    r"\\(emph|textit|texttt|textbf|textsc|url|foreignlanguage|href)\b"
)
# A single letter immediately before a '.' is an initial ("J.", "C.") --
# that period is not the end of the author list. (Deliberately NOT any
# short word: real two-and-three-letter surnames, e.g. "Wu", "Li", "He",
# are common and must not be mistaken for an abbreviation.)
ABBREV_TOKEN_RE = re.compile(r"^[A-Za-z]$")
# Multi-letter abbreviations that are not the end of the author list either
# ("eds" in "(eds.)"); "al" in "et al." is handled separately below since it
# is the one case where the abbreviation DOES end the author list.
ABBREV_WORDS = {"eds", "ed", "jr", "sr"}

MAX_SHORTFORM_CHARS = 42  # budget for "Author Year" + optional title fragment
MIN_TITLE_WORDS = 2


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def find_author_boundary(flat: str) -> int:
    """Index just after the period that ends the author list in a bibitem
    entry with NO \\newblock markers (two hand-written styles in this corpus
    use bare periods instead: `Author. "Title." Venue, Year.` and `Author.
    Title. Venue, Year.`). Scans candidate periods left to right, skipping
    one preceded by a short alphabetic token (an initial like "J." or "C.",
    or "al"/"eds" in "et al."/"(eds.)"), and returns the first period that
    is not. Falls back to len(flat) (no boundary found) if the string has no
    period at all."""
    i = 0
    while True:
        idx = flat.find(".", i)
        if idx == -1:
            return len(flat)
        k = idx
        while k > 0 and flat[k - 1] not in " \t(.":
            k -= 1
        token = flat[k:idx].lstrip("~-")
        if token.lower() == "al" and flat[max(0, k - 4) : k].strip().rstrip("~") == "et":
            # "et al." always ends the author list.
            return idx + 1
        if ABBREV_TOKEN_RE.match(token) or token.lower() in ABBREV_WORDS:
            i = idx + 1
            continue
        return idx + 1


def strip_comments(text: str) -> str:
    out = []
    for line in text.split("\n"):
        cut = None
        i = 0
        while i < len(line):
            if line[i] == "%" and (i == 0 or line[i - 1] != "\\"):
                cut = i
                break
            i += 1
        out.append(line[:cut] if cut is not None else line)
    return "\n".join(out)


def rel(path: str) -> str:
    return os.path.relpath(os.path.join(REPO_ROOT, path) if not os.path.isabs(path) else path, REPO_ROOT)


def load_textbook() -> dict:
    path = os.path.join(REPO_ROOT, TEXTBOOK_REL)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def split_bibitems(bib_block: str) -> list[tuple[str, str]]:
    """Return (key, entry_text) for every \\bibitem in one thebibliography
    block, entry_text running from just after the \\bibitem{key} to just
    before the next \\bibitem or \\end{thebibliography}."""
    matches = list(BIBITEM_RE.finditer(bib_block))
    out = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else bib_block.rfind("\\end{thebibliography}")
        out.append((m.group(1), bib_block[start:end].strip()))
    return out


NAME_PARTICLES = {"van", "von", "der", "den", "de", "du", "la", "le", "di", "da"}


def last_word(name: str) -> str:
    name = name.strip().rstrip(".,")
    parts = name.split()
    if not parts:
        return name
    # Walk back over EVERY leading particle, not just one: "van der Waals" and
    # "de la Cruz" carry two, and stopping after the first drops the head of
    # the surname ("der Waals", "la Cruz"). Guard the index so a name that is
    # nothing but particles cannot consume the whole list.
    i = len(parts) - 1
    while i > 0 and parts[i - 1].lower().lstrip("~-") in NAME_PARTICLES:
        i -= 1
    return " ".join(parts[i:])


def parse_authors(raw: str) -> str | None:
    """Return a short author form ("Surname", "Surname & Surname", or
    "Surname et al.") or None if raw does not look like a list of personal
    names."""
    raw = raw.strip()
    if not raw or not NAME_LINE_RE.match(raw) or NAME_MARKUP_BLOCKLIST_RE.search(raw):
        return None
    # A LaTeX tie ("J.~Meseguer", tying an initial to a surname so they never
    # break across a line) must not glue the two into one whitespace-split
    # token -- normalize it to a plain space before splitting on anything.
    raw = raw.replace("~", " ")
    raw = raw.rstrip(".").strip()
    if not raw:
        return None

    et_al_match = re.search(r"\bet\s+al\.?\b", raw)
    if et_al_match:
        first = raw[: et_al_match.start()].strip().rstrip(",")
        if not first:
            return None
        return f"{last_word(first)} et al."

    # Split on ", and " / " and " / " \& " / ", " -- an Oxford-comma author
    # list, a simple "A and B" pair, or an "A \& B" pair collapse to the same
    # token list either way.
    parts = [
        p.strip()
        for p in re.split(r",\s*(?:and\s+)?|\s+and\s+|\s*\\&\s*|\s*&\s*", raw)
        if p.strip()
    ]
    if not parts:
        return None
    if len(parts) == 1:
        return last_word(parts[0])
    if len(parts) == 2:
        # \& (escaped), not a bare "&" -- a bare ampersand is a LaTeX
        # alignment-tab character outside a tabular/array environment and
        # would break the margin note the moment it is typeset in prose.
        return f"{last_word(parts[0])} \\& {last_word(parts[1])}"
    return f"{last_word(parts[0])} et al."


QUOTED_TITLE_RE = re.compile(r"^``(.*?)''", re.DOTALL)
LEADING_EMPH_START_RE = re.compile(r"^\\(?:emph|textit)\{")


def extract_leading_emph(raw: str) -> str | None:
    """If `raw` starts with \\emph{...} or \\textit{...}, return the
    brace-balanced content of that command and discard everything after its
    closing brace (a style-A \\newblock chunk sometimes glues the title and
    the venue into one chunk, e.g. "\\textit{Governing the Commons...}.
    Cambridge University Press, 1990." -- the venue must not leak into the
    title). Returns None if `raw` does not start with one of those commands,
    or the braces never balance."""
    m = LEADING_EMPH_START_RE.match(raw)
    if not m:
        return None
    i = m.end()
    depth = 1
    start = i
    while i < len(raw) and depth > 0:
        if raw[i] == "{":
            depth += 1
        elif raw[i] == "}":
            depth -= 1
        i += 1
    if depth != 0:
        return None
    return raw[start : i - 1]


def clean_title(raw: str) -> str | None:
    raw = raw.strip()
    if not raw:
        return None
    leading = extract_leading_emph(raw)
    if leading is not None:
        raw = leading.strip()
    raw = raw.rstrip(".").strip()
    # NOTE: \% and \& (and accents) are left exactly as escaped -- this text
    # becomes literal LaTeX source in the generated table, and a bare & or %
    # is not valid outside a tabular cell / would start a comment.
    # A style-A \newblock chunk sometimes carries the title AND the
    # publication year with no separate \newblock in between (e.g. "Of the
    # Original Contract. 1748"); strip a bare trailing year so it does not
    # also show up duplicated inside the italic title fragment.
    raw = re.sub(r"[.,]?\s*(1[4-9]\d{2}|20\d{2})\.?\s*$", "", raw).strip()
    return raw or None


def extract_inline_title(remainder: str) -> str | None:
    """Title extraction for the two \\newblock-free bibliography styles:
    `Author. \`\`Title.'' \\emph{Venue}...` (quoted) and `Author. Title.
    \\emph{Venue}...` (bare, e.g. sealed-harbor.tex) or `Author. \\emph{Title.}
    Venue...` (a book title with no separate venue, e.g. Ostrom 1990).
    `remainder` is the entry text after the author-list boundary period."""
    remainder = remainder.strip()
    if not remainder:
        return None
    m = QUOTED_TITLE_RE.match(remainder)
    if m:
        return clean_title(m.group(1))
    if LEADING_EMPH_START_RE.match(remainder):
        return clean_title(remainder)
    # Bare, unquoted, unitalicized title: up to the next genuine sentence
    # boundary, using the same abbreviation-aware scan as the author split
    # (a title practically never ends in a bare initial, so this is safe).
    boundary = find_author_boundary(remainder)
    return clean_title(remainder[:boundary])


def title_fragment(title: str, budget: int) -> str | None:
    """First few words of `title` that fit in `budget` characters, or None if
    even the first two words do not fit."""
    words = title.split()
    if len(words) < MIN_TITLE_WORDS:
        candidate = title
        return candidate if len(candidate) <= budget else None
    out = []
    used = 0
    for i, w in enumerate(words):
        add = len(w) + (1 if out else 0)
        if used + add > budget:
            break
        out.append(w)
        used += add
    if len(out) < MIN_TITLE_WORDS:
        return None
    frag = " ".join(out)
    if len(out) < len(words):
        frag += "\\ldots"
    return frag


def escape_stray_specials(s: str) -> str:
    """Escape any bare (not already backslash-escaped) &, %, #, or _ --
    each is a LaTeX special character (alignment tab, comment-starter,
    macro-parameter marker, subscript marker) outside its own narrow
    context. One can arrive here either from a hand-written entry that
    itself has an un-escaped one, or, defensively, from a parsing edge case
    this script did not anticipate."""
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c in "&%#_" and (i == 0 or s[i - 1] != "\\"):
            out.append("\\" + c)
        else:
            out.append(c)
        i += 1
    return "".join(out)


def is_brace_balanced(s: str) -> bool:
    """Defensive final check: whatever the parse produced, never emit a
    \\pdciteshort row LaTeX itself cannot brace-match (a hand-written
    bibliography is too varied for the heuristics above to be exhaustive --
    this is the net under them, not a substitute for getting them right)."""
    depth = 0
    for c in s:
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def tex_escape_shortform(s: str) -> str:
    # The strings we build are already near-plain-text (surnames, years,
    # title words) pulled out of hand-written LaTeX; only a bare `&` from an
    # un-escaped author-list join needs guarding here (the parser already
    # unescapes \& in titles above, so this only ever fires on the literal
    # " & " this script itself inserts between two surnames, which must stay
    # unescaped -- so this function is a no-op today, kept for the one case
    # a future author name arrives with a raw # or _ in it).
    return s.replace("#", "\\#").replace("_", "\\_")


def parse_chapter(path: str) -> tuple[dict[str, str], list[tuple[str, str]]]:
    """Returns (key -> shortform, [(key, reason)] for unparsed keys)."""
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read()
    text = strip_comments(raw)
    shortforms: dict[str, str] = {}
    unparsed: list[tuple[str, str]] = []

    bib_match = THEBIB_RE.search(text)
    if not bib_match:
        return shortforms, unparsed
    for key, entry_text in split_bibitems(bib_match.group(0)):
        if "\\newblock" in entry_text:
            # Style A: `Author.\n\newblock Title.\n\newblock Venue, Year.`
            blocks = [b.strip() for b in entry_text.split("\\newblock")]
            author_raw = blocks[0] if blocks else ""
            title_raw = blocks[1] if len(blocks) >= 2 else None
            title = clean_title(title_raw) if title_raw is not None else None
        else:
            # Styles B/C: no \newblock at all -- `Author. "Title." Venue,
            # Year.` or `Author. Title. Venue, Year.`, found by an
            # abbreviation-aware scan for the period that ends the author list.
            flat = normalize_whitespace(entry_text)
            boundary = find_author_boundary(flat)
            author_raw = flat[:boundary]
            title = extract_inline_title(flat[boundary:])

        author_short = parse_authors(author_raw)
        if author_short is None:
            unparsed.append((key, "author line does not look like a list of personal names"))
            continue
        year = find_year(entry_text)
        if year is None:
            unparsed.append((key, "no four-digit year found in entry"))
            continue
        prefix = tex_escape_shortform(f"{author_short} {year}")

        if title is None:
            # No usable title -- "Author Year" alone is still a legitimate
            # short form (this is not fatal the way a missing author/year is).
            candidate = prefix
        else:
            budget = MAX_SHORTFORM_CHARS - len(prefix) - 2  # ", " separator
            frag = title_fragment(title, budget) if budget > 0 else None
            candidate = f"{prefix}, \\textit{{{frag}}}" if frag else prefix

        candidate = escape_stray_specials(candidate)
        if not is_brace_balanced(candidate):
            unparsed.append((key, f"generated short form has unbalanced braces: {candidate!r}"))
            continue
        shortforms[key] = candidate

    return shortforms, unparsed


HEADER = """% GENERATED by scripts/harbor-research/build_cite_shortforms.py from the
% eight Book chapters' own \\bibitem entries -- do not hand-edit. Regenerate
% with: python3 scripts/harbor-research/build_cite_shortforms.py
%
% One \\pdciteshort{key}{short form} per parseable \\bibitem key, read by
% \\pdcite (figures/pd-pedagogy.tex) for its Book-only margin note. A key with
% no row here falls back to printing its own bibliography key.
% Twin copy: whitepaper/figures/pd-cite-shortforms.tex and
% website-v2/public/whitepaper/figures/pd-cite-shortforms.tex are kept
% byte-identical by this script (both preambles \\input it via
% figures/pd-pedagogy.tex).
"""


def render(shortforms: dict[str, str]) -> str:
    lines = [HEADER.rstrip("\n"), ""]
    for key in sorted(shortforms):
        lines.append(f"\\pdciteshort{{{key}}}{{{shortforms[key]}}}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="fail if the committed copies are stale; write nothing")
    args = parser.parse_args()

    textbook = load_textbook()
    all_shortforms: dict[str, str] = {}
    all_unparsed: list[tuple[str, str, str]] = []  # (chapter, key, reason)
    conflicts: list[str] = []

    for chapter in textbook["chapters"]:
        path = os.path.join(REPO_ROOT, chapter["source"])
        shortforms, unparsed = parse_chapter(path)
        for key, reason in unparsed:
            all_unparsed.append((chapter["source"], key, reason))
        for key, sf in shortforms.items():
            if key in all_shortforms and all_shortforms[key] != sf:
                conflicts.append(
                    f"  {key}: {chapter['source']} gives {sf!r}, "
                    f"an earlier chapter gave {all_shortforms[key]!r} (keeping the first)"
                )
                continue
            all_shortforms.setdefault(key, sf)

    rendered = render(all_shortforms)

    print(f"parsed {len(all_shortforms)} short form(s) across {len(textbook['chapters'])} chapter(s)")
    if all_unparsed:
        print(f"\n{len(all_unparsed)} UNPARSED bibitem key(s) (falls back to the raw key in \\pdcite):")
        for chapter_source, key, reason in all_unparsed:
            print(f"  {chapter_source}: \\bibitem{{{key}}} -- {reason}")
    if conflicts:
        print(f"\n{len(conflicts)} cross-chapter shortform conflict(s) (kept the first seen):")
        for line in conflicts:
            print(line)

    if args.check:
        stale = []
        for target in TARGETS:
            path = os.path.join(REPO_ROOT, target)
            on_disk = None
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    on_disk = fh.read()
            if on_disk != rendered:
                stale.append(target)
        if stale:
            print(f"\nSTALE: {', '.join(stale)} do not match a fresh render; run without --check", file=sys.stderr)
            return 1
        print("\nboth copies of pd-cite-shortforms.tex are up to date")
        return 0

    for target in TARGETS:
        path = os.path.join(REPO_ROOT, target)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(rendered)
        print(f"wrote {target} ({len(rendered)} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
