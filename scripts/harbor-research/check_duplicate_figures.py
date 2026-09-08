#!/usr/bin/env python3
"""No drawing appears twice in the Book under two figure numbers.

WHY THIS EXISTS. A critical reader of the manuscript wrote that "the four-message
cross-harbor transfer appears in both Chapter 6 and Chapter 8; the threat-band
matrix is duplicated". Checking it mechanically found not two duplicates but
seven: chapters 6 and 8 share five figures and tables outright, chapter 6 shares
a game matrix with chapter 7, and chapters 5 and 6 share a table.

Each chapter is a standalone paper's twin, so a fragment `\\input` by two
chapters renders TWICE in the Book -- two figure numbers, two captions, one
drawing -- while each standalone PDF quite correctly carries its own copy. The
defect is invisible in the sources (each chapter reads fine alone) and invisible
in the standalones (where it is not a defect at all). It is only visible in the
assembled Book, which is exactly why it survived to a 530-page draft and needed
an outside reader to notice.

So this is a check and not a one-time edit. The fix for any row it reports is to
pick the chapter that OWNS the drawing -- the one that develops the idea -- and
have the other cross-reference it with \\Cref rather than re-inputting it.

APPARATUS IS NOT A DRAWING. Every chapter inputs the same preamble apparatus
(palette, hyperlinks, pedagogy, figure language, chapter map) and must: the
generator strips chapter preambles and the Book loads them once. Apparatus is
identified the way the figure-gates workflow identifies it -- read from the
Book preamble's own \\input lines, transitively -- rather than from a list here
that would drift.

Exit 1 when a drawing is shared. `--allow slug` records a deliberate exception.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BOOK_PREAMBLE = REPO / 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex'
TEXTBOOK = REPO / 'whitepaper/textbook.json'
FIGURE_DIRS = [
    REPO / 'website-v2/public/whitepaper/figures',
    REPO / 'whitepaper/figures',
]

INPUT_RE = re.compile(r'\\input\{figures/([a-z0-9-]+)\}')
COMMENT_RE = re.compile(r'(?<!\\)%.*$')


def strip_comments(text: str) -> str:
    """A commented-out \\input is not an input. Escaped \\% is not a comment."""
    return '\n'.join(COMMENT_RE.sub('', line) for line in text.splitlines())


IFBOOK_RE = re.compile(r'\\ifpdbook\b')


def book_branch(text: str) -> str:
    r"""Keep only what the Book compiles: the \ifpdbook branch of each conditional.

    A drawing two chapters share is a defect in the BOOK and not in either
    standalone paper, which quite correctly carries its own copy -- this file
    said so in its own docstring before the sources had any way to express it.
    \ifpdbook is that way, so an \input sitting in the \else branch is not a
    Book input and must not be counted as one.
    """
    return pdbook_branch(text, book=True)


def standalone_branch(text: str) -> str:
    r"""Keep only what a standalone paper compiles: the \else branch of each
    \ifpdbook, which is what check_standalone_figures.py counts against its
    record. The same scanner, the other side of the conditional."""
    return pdbook_branch(text, book=False)


def pdbook_branch(text: str, book: bool) -> str:
    r"""One side of every \ifpdbook conditional, text outside them untouched.

    A small scanner rather than a regex: the branches contain prose, nested
    \ifnum and \ifx from other macros, and the conditionals must nest.
    """
    out, i, n = [], 0, len(text)
    while i < n:
        m = IFBOOK_RE.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i:m.start()])
        # Walk from here, tracking nesting, collecting the wanted branch only.
        depth, j, keep, taking = 0, m.end(), [], book
        while j < n:
            nxt = min(
                (x for x in (text.find('\\if', j), text.find('\\else', j),
                             text.find('\\fi', j)) if x >= 0),
                default=-1,
            )
            if nxt < 0:
                keep.append(text[j:]); j = n; break
            if taking:
                keep.append(text[j:nxt])
            if text.startswith('\\ifpdbook', nxt) or (
                text.startswith('\\if', nxt) and not text.startswith('\\fi', nxt)
            ):
                depth += 1
                if taking:
                    keep.append(text[nxt:nxt + 3])
                j = nxt + 3
            elif text.startswith('\\else', nxt):
                if depth == 0:
                    taking = not book
                elif taking:
                    keep.append(text[nxt:nxt + 5])
                j = nxt + 5
            else:  # \fi
                if depth == 0:
                    j = nxt + 3
                    break
                depth -= 1
                if taking:
                    keep.append(text[nxt:nxt + 3])
                j = nxt + 3
        out.append(''.join(keep))
        i = j
    return ''.join(out)


def inputs_of(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    text = book_branch(strip_comments(path.read_text(encoding='utf-8')))
    return set(INPUT_RE.findall(text))


def fragment_path(name: str) -> Path | None:
    for d in FIGURE_DIRS:
        p = d / f'{name}.tex'
        if p.is_file():
            return p
    return None


def apparatus() -> set[str]:
    """The Book preamble's own inputs, followed to a fixed point.

    Transitive because apparatus inputs apparatus: pd-pedagogy pulls in the
    generated pd-cite-shortforms and pd-discharges, and reading one level would
    report those two generated tables as duplicated drawings in all eight
    chapters.
    """
    seen = inputs_of(BOOK_PREAMBLE)
    while True:
        more = set()
        for name in seen:
            p = fragment_path(name)
            if p:
                more |= inputs_of(p)
        if more <= seen:
            return seen
        seen |= more


def chapters() -> list[tuple[int, str, Path]]:
    """(number, id, source path) for each chapter, from the one TOC data source."""
    import json
    data = json.loads(TEXTBOOK.read_text(encoding='utf-8'))
    out = []
    for ch in data['chapters']:
        src = REPO / ch['source']
        out.append((ch['number'], ch['id'], src))
    return sorted(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--allow', action='append', default=[],
                    help='fragment name that may legitimately appear in two chapters')
    args = ap.parse_args()

    skip = apparatus() | set(args.allow)
    where: dict[str, list[tuple[int, str]]] = {}
    missing = []
    for number, cid, src in chapters():
        if not src.is_file():
            missing.append(str(src))
            continue
        for name in inputs_of(src):
            if name in skip:
                continue
            where.setdefault(name, []).append((number, cid))

    if missing:
        print('-- 1 chapter source(s) named by textbook.json but absent on disk:')
        for m in missing:
            print(f'     {m}')
        return 1

    shared = {n: v for n, v in sorted(where.items()) if len(v) > 1}
    if not shared:
        print(f'ok: {len(where)} drawings, each owned by exactly one chapter '
              f'({len(skip)} apparatus files exempt)')
        return 0

    print(f'-- {len(shared)} drawing(s) rendered twice in the Book, under two '
          f'figure numbers each:')
    for name, sites in shared.items():
        chs = ', '.join(f'ch.{n} {cid}' for n, cid in sites)
        print(f'     {name:<28} {chs}')
    print()
    print('   Each of these prints the same drawing in two places with two')
    print('   numbers and two captions. Decide which chapter develops the idea,')
    print('   keep the \\input there, and cross-reference it from the other with')
    print('   \\Cref. A standalone paper keeps its own copy either way -- the')
    print('   duplication exists only in the assembled Book.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
