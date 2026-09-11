#!/usr/bin/env python3
"""promote_provenance.py -- replace an inline [verified]/[internal] tag with
\\pdprov{script}{seed}{tag} at the point of use.

\\pdprov{script}{seed}{tag} (figures/pd-pedagogy.tex) renders, in the Book, a
margin note "script . seed . TAG"; in a standalone chapter it folds back to
exactly the bracket form it replaces ("[tag]"), so no chapter's rendered
prose changes outside the Book.

Matching a bare "[verified]"/"[internal]" tag in the eight Book chapters
(whitepaper/textbook.json's chapters[].source) to a script and seed:

  1. Only entries in docs/harbor-research/library-index.json whose
     chapters[] names the CURRENT chapter file are candidates -- an entry's
     numbers[].regex is only trustworthy evidence for a number actually
     claimed to live in this file (check_library_index.py's own drift check
     verifies exactly that).
  2. For each tag occurrence, search backward from it, within the same
     paragraph (back to the previous blank line, or the start of the
     chapter), for the LAST (closest-preceding) match of any candidate
     entry's numbers[].regex.
  3. The candidate entry must have exactly one tag value across the numbers
     whose regex matched, and it must equal the tag already written inline
     (a mismatch means the match is probably the wrong number -- safer to
     leave the inline tag alone than silently flip verified/internal).
  4. script is the entry's sole scripts[] entry; when an entry lists more
     than one, the one whose filename stem shares a word with the matched
     number's own `name` is preferred, falling back to the first with a note.
  5. seed is read from the script's own header comment (a literal
     "seed ... NNNNNNNN" or "SEED = NNNNNNNN"); defaulting to 20260816 (the
     house convention documented in skills/harbor-results/SKILL.md and
     docs/harbor-research/README.md) when the script does not state one.

A tag with no candidate entry for its chapter, no regex match nearby, or a
tag/entry mismatch is left exactly as it was -- this script never guesses.

Usage:
    python3 scripts/harbor-research/promote_provenance.py [--check]

Reports, per chapter: tags replaced, tags left (with why).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEXTBOOK_REL = "whitepaper/textbook.json"
INDEX_REL = "docs/harbor-research/library-index.json"

TAG_RE = re.compile(r"\[(verified|internal)\]")
SEARCH_WINDOW = 1200  # chars to look back from a tag for the paragraph start
DEFAULT_SEED = "20260816"
SEED_RE = re.compile(r"(?:seed|SEED)\s*[:=]?\s*\"?(\d{6,})\"?", re.IGNORECASE)


def load_json(rel_path: str) -> dict:
    with open(os.path.join(REPO_ROOT, rel_path), encoding="utf-8") as fh:
        return json.load(fh)


def balanced_group_end(text: str, open_brace: int) -> int:
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


def texttt_spans(text: str) -> list[tuple[int, int]]:
    """A [tag] inside \\texttt{...} is quoted verbatim script output (a
    session transcript), not a live provenance annotation in running prose --
    it must be left exactly as printed, the same reasoning
    promote_cites.py's protected regions document."""
    spans = []
    for m in re.finditer(r"\\texttt\{", text):
        brace = m.end() - 1
        spans.append((m.start(), balanced_group_end(text, brace)))
    return spans


def in_any_span(pos: int, spans: list[tuple[int, int]]) -> bool:
    for start, end in spans:
        if start <= pos < end:
            return True
    return False


def paragraph_start(text: str, pos: int) -> int:
    at = text.rfind("\n\n", max(0, pos - SEARCH_WINDOW), pos)
    if at == -1:
        return max(0, pos - SEARCH_WINDOW)
    return at + 2


def script_seed(script_rel: str, cache: dict[str, str]) -> str:
    if script_rel in cache:
        return cache[script_rel]
    path = os.path.join(REPO_ROOT, script_rel)
    seed = DEFAULT_SEED
    if os.path.isfile(path):
        with open(path, encoding="utf-8", errors="replace") as fh:
            head = fh.read(4000)
        m = SEED_RE.search(head)
        if m:
            seed = m.group(1)
    cache[script_rel] = seed
    return seed


def pick_script(entry: dict, number_name: str) -> tuple[str, bool]:
    """Returns (script_rel_path, ambiguous)."""
    scripts = entry.get("scripts", [])
    if not scripts:
        return "", False
    if len(scripts) == 1:
        return scripts[0], False
    name_words = set(re.findall(r"[a-z]+", number_name.lower()))
    for s in scripts:
        stem_words = set(re.findall(r"[a-z]+", os.path.basename(s).lower()))
        if name_words & stem_words:
            return s, False
    return scripts[0], True


def candidates_for_file(index: dict, chapter_source: str) -> list[dict]:
    out = []
    for entry in index["entries"]:
        if any(c["file"] == chapter_source for c in entry.get("chapters", [])):
            out.append(entry)
    return out


def find_match(text: str, tag_start: int, tag_value: str, candidates: list[dict]):
    """Returns (entry, number, script, ambiguous) for the closest-preceding
    regex match among `candidates`' numbers in the current paragraph that
    ALSO has a usable script, or None if nothing qualifies. Every qualifying
    match is considered, nearest first, in case the nearest one belongs to
    an entry with no scripts[] to cite (e.g. R3)."""
    para_start = paragraph_start(text, tag_start)
    window = text[para_start:tag_start]
    found: list[tuple[int, dict, dict]] = []  # (match_end, entry, number)
    for entry in candidates:
        for number in entry.get("numbers", []):
            if number.get("tag") != tag_value:
                continue  # tag/entry mismatch -- not trustworthy, see module docstring
            try:
                pattern = re.compile(number["regex"])
            except re.error:
                continue
            last = None
            for m in pattern.finditer(window):
                last = m
            if last is not None:
                found.append((last.end(), entry, number))
    for _, entry, number in sorted(found, key=lambda t: t[0], reverse=True):
        script, ambiguous = pick_script(entry, number["name"])
        if script:
            return entry, number, script, ambiguous
    return None


def promote(text: str, chapter_source: str, index: dict, seed_cache: dict) -> tuple[str, int, list[str]]:
    candidates = candidates_for_file(index, chapter_source)
    protected = texttt_spans(text)
    out = []
    last = 0
    replaced = 0
    left: list[str] = []
    for m in TAG_RE.finditer(text):
        tag_value = m.group(1)
        if in_any_span(m.start(), protected):
            line_no = text[: m.start()].count("\n") + 1
            left.append(
                f"{chapter_source}:{line_no}: [{tag_value}] -- inside \\texttt{{...}} "
                "(quoted script output, not a live provenance tag)"
            )
            continue
        result = find_match(text, m.start(), tag_value, candidates) if candidates else None
        if result is None:
            line_no = text[: m.start()].count("\n") + 1
            left.append(f"{chapter_source}:{line_no}: [{tag_value}] -- no matching library-index number nearby")
            continue
        entry, number, script, ambiguous = result
        seed = script_seed(script, seed_cache)
        # \pdprov's first argument is set in \texttt{...} in the Book -- a
        # bare "_" there is LaTeX's subscript operator, invalid outside math
        # mode ("Missing $ inserted"), and every script under
        # skills/harbor-results/scripts/ uses snake_case filenames.
        script_name = os.path.basename(script).replace("_", "\\_")
        out.append(text[last : m.start()])
        out.append(f"\\pdprov{{{script_name}}}{{{seed}}}{{{tag_value}}}")
        last = m.end()
        replaced += 1
        if ambiguous:
            line_no = text[: m.start()].count("\n") + 1
            left.append(
                f"{chapter_source}:{line_no}: [{tag_value}] replaced using {entry['id']}'s first script "
                f"({script_name}) -- more than one script listed, none matched number name {number['name']!r}"
            )
    out.append(text[last:])
    return "".join(out), replaced, left


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="report only, write nothing; exit 1 if anything would change")
    args = parser.parse_args()

    textbook = load_json(TEXTBOOK_REL)
    index = load_json(INDEX_REL)
    seed_cache: dict[str, str] = {}

    total_replaced = 0
    total_left = 0
    any_change = False
    all_left: list[str] = []

    for chapter in textbook["chapters"]:
        path = os.path.join(REPO_ROOT, chapter["source"])
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        new_text, replaced, left = promote(text, chapter["source"], index, seed_cache)
        total_replaced += replaced
        total_left += len(left)
        all_left.extend(left)
        changed = new_text != text
        any_change = any_change or changed
        print(
            f"{chapter['source']}: {replaced} replaced, {len(left)} left"
            + ("" if not args.check else f" [{'would change' if changed else 'no change'}]")
        )
        if not args.check and changed:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(new_text)

    print(f"\nTOTAL: {total_replaced} replaced, {total_left} left across {len(textbook['chapters'])} chapter(s)")
    if all_left:
        print("\nLeft in place (no confident match):")
        for line in all_left:
            print(f"  {line}")

    if args.check:
        return 1 if any_change else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
