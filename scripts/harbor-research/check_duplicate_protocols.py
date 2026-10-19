#!/usr/bin/env python3
r"""No message ceremony is written out step by step in two chapters of the Book.

WHY THIS EXISTS. check_duplicate_figures.py was built because an outside reader
found that "the four-message cross-harbor transfer appears in both Chapter 6 and
Chapter 8; the threat-band matrix is duplicated". The drawings were fixed --
chapter 6 now defers to chapter 8 inside \ifpdbook -- and the figure check went
green and stayed green. The ceremony itself did not move. Chapter 6 still writes
out xfer_req / xfer_offer / xfer_ack / xfer_deliver as a four-item Protocol, and
chapter 8 writes the same four messages out again as a four-item enumerate, so
the Book still says the same protocol twice and neither existing check can see
it: check_duplicate_figures keys on \input of a shared fragment (there is none
-- chapter 8's copy is hand-written prose) and check_duplicate_theorems keys on
a shared \label (there is none -- chapter 8's copy is an unlabelled enumerate).

A green check over the half of the defect that was fixed is worse than no check,
because it is read as coverage. This is the other half.

WHAT COUNTS AS A CEREMONY. A protocol message name in this corpus is a
snake_case token set in a code or math font -- \mathsf{xfer\_req},
\texttt{begin\_work}. A chapter is *writing the ceremony out* when such a token
introduces a step: it appears at the head of an \item. Two chapters sharing
three or more step-introducing message names are stating the same ceremony
twice. Two shared names are not enough: one chapter can perfectly well name
another's messages in passing ("the offer of \S8.4") without restating anything,
and the threshold is there so that passing mention stays free.

Only the \ifpdbook branch is read, like both sibling checks: a standalone paper
quite correctly carries its own copy of a ceremony another chapter owns, and the
duplication exists only in the assembled Book.

Exit 1 when a ceremony is shared. `--allow a:b:m1,m2,...` records a deliberate
exception -- the chapter pair and the exact shared message names -- so that a
known duplicate does not block the queue while it waits for an owner, and so
that a *different* duplication, or a change to this one, still fails.
"""
from __future__ import annotations

import argparse
import itertools
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_duplicate_figures import book_branch, chapters, strip_comments  # noqa: E402

# A protocol message name: snake_case (at least one underscore, escaped as TeX
# requires in these fonts), letters and digits only, set in one of the three
# fonts the chapters use for wire names. Prose never looks like this.
MESSAGE_RE = re.compile(
    r'\\(?:mathsf|texttt|textsf)\{([A-Za-z][A-Za-z0-9]*(?:\\_[A-Za-z0-9]+)+)\}'
)

# The head of a list item: \item, an optional [label], then the text. A message
# name inside this window is introducing the step rather than being referred to
# from the middle of a paragraph-long item.
ITEM_HEAD_RE = re.compile(r'\\item\b\s*(?:\[[^\]]*\])?\s*(.{0,120})', re.S)

MIN_SHARED = 3


def message_names(text: str) -> set[str]:
    """Every protocol message name in the Book-compiled text, step or not."""
    return set(MESSAGE_RE.findall(book_branch(strip_comments(text))))


def step_names(text: str) -> set[str]:
    """Message names that introduce a list item in the Book-compiled text.

    These are the names a chapter is *defining a step for*, which is what makes
    two chapters' lists the same ceremony rather than one citing the other.
    """
    text = book_branch(strip_comments(text))
    out: set[str] = set()
    for head in ITEM_HEAD_RE.finditer(text):
        out.update(MESSAGE_RE.findall(head.group(1)))
    return out


def allow_key(a: int, b: int, shared: set[str]) -> str:
    """The exception key for one shared ceremony: the chapter pair, low number
    first, and the exact shared message names, so that adding or removing a
    message retires the exception instead of silently widening it."""
    names = ','.join(sorted(n.replace('\\_', '_') for n in shared))
    lo, hi = sorted((a, b))
    return f'{lo}:{hi}:{names}'


def find_shared(chapter_texts, allow=()):
    """[(a, a_id, b, b_id, shared names)] for every chapter pair that writes the
    same ceremony out, minus the recorded exceptions."""
    steps = {n: (cid, step_names(t)) for n, cid, t in chapter_texts}
    found = []
    for a, b in itertools.combinations(sorted(steps), 2):
        a_id, a_steps = steps[a]
        b_id, b_steps = steps[b]
        shared = a_steps & b_steps
        if len(shared) < MIN_SHARED or allow_key(a, b, shared) in allow:
            continue
        found.append((a, a_id, b, b_id, shared))
    return found


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--allow', action='append', default=[],
                    help='a:b:m1,m2,... -- a chapter pair and the exact shared '
                         'message names that may legitimately appear twice')
    args = ap.parse_args(argv)

    texts, missing = [], []
    for number, cid, src in chapters():
        if not src.is_file():
            missing.append(str(src))
            continue
        texts.append((number, cid, src.read_text(encoding='utf-8')))
    if missing:
        print(f'-- {len(missing)} chapter source(s) named by textbook.json but absent on disk:')
        for m in missing:
            print(f'     {m}')
        return 1

    total = sum(len(step_names(t)) for _, _, t in texts)
    shared = find_shared(texts, set(args.allow))
    if not shared:
        print(f'ok: {total} message names introduce a step across {len(texts)} '
              f'chapters, no ceremony written out twice '
              f'({len(args.allow)} allowed)')
        return 0

    print(f'-- {len(shared)} ceremony/ceremonies written out in two chapters of the Book:')
    for a, a_id, b, b_id, names in shared:
        pretty = ', '.join(sorted(n.replace('\\_', '_') for n in names))
        print(f'     ch.{a} {a_id} and ch.{b} {b_id} both step through: {pretty}')
        print(f'       allow key: {allow_key(a, b, names)}')
    print()
    print('   Both chapters give the reader the same protocol as a numbered list,')
    print('   so the Book states it twice under two numbers with no \\input and no')
    print('   shared \\label for the sibling checks to catch. Decide which chapter')
    print('   owns the ceremony, keep the steps there, and have the other state')
    print('   its requirement in prose with a \\pdchapref -- inside \\ifpdbook, so')
    print('   the standalone paper keeps its own copy in the \\else branch.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
