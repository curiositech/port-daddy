#!/usr/bin/env python3
r"""No theorem is stated twice in the Book under two numbers.

WHY THIS EXISTS. check_duplicate_figures.py catches a drawing two chapters
share, and it can, because a shared drawing is a shared `\input` line. A shared
THEOREM has no such line. Chapter 6 and chapter 8 each carried their own
\begin{pdclaim} for the conditional escrow bound, and the Book printed it as a
Design Invariant in one chapter and again, under a fresh number, in the other
-- with different titles ("Bounded custody loss, conditional" against
"Conditional Escrow Extraction Bound") and different wording, so no comparison
of the text would have paired them. What paired them was the label: both were
\label{thm:fh-escrow-bound}. The generator namespaces every label with its
chapter's prefix precisely so that two chapters CAN reuse a name without the
Book failing to compile -- the right default for sec:intro and fig:overview,
and exactly the mechanism that let a duplicated theorem through in silence.

So the signal here is the label, and only the label. Titles were measured as a
second signal and rejected: chapters 3, 6 and 7 each state their own claim
titled "Conservation", and they are three different theorems about three
different ledgers. A theorem-family environment (theorem, lemma, proposition,
corollary, conjecture, definition, property, protocol, remark, and the pdclaim
box) whose label appears in two chapters is reported; the fix is the same as
for a drawing -- decide which chapter proves it, keep the statement there, and
have the other chapter refer to it (\ref{<prefix>:<label>} inside \ifpdbook,
which the generator now leaves un-namespaced).

Same discipline as the figure check: read only what the Book compiles, the
\ifpdbook branch of each conditional, because a standalone paper keeps its own
statement and the duplication exists only in the assembled Book.

Exit 1 when a label is shared. `--allow label` records a deliberate exception
-- a definition two chapters restate on purpose, say, until someone decides
which chapter owns it -- and the workflow that passes it says why.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_duplicate_figures import book_branch, chapters, strip_comments  # noqa: E402

# The numbered statement environments every chapter preamble and the Book
# preamble declare (\newtheorem in each, pdclaim in figures/pd-pedagogy.tex),
# plus the per-chapter protocol variants that pd-hyperlinks gives \crefname s.
# A starred form (remark*) is unnumbered but is still a statement a reader
# meets twice.
THEOREM_ENVS = (
    'theorem', 'lemma', 'proposition', 'corollary', 'conjecture', 'definition',
    'property', 'protocol', 'remark', 'pdclaim',
    'lsprotocol', 'stpprotocol', 'heprotocol',
)
BEGIN_RE = re.compile(r'\\begin\{(' + '|'.join(THEOREM_ENVS) + r')\*?\}')
LABEL_RE = re.compile(r'\\label\{([^}]+)\}')


def theorem_labels(text: str) -> list[tuple[str, str]]:
    r"""(label, environment) for each labelled statement in Book-compiled text.

    The statement's own label is the first \label inside the environment --
    the convention every chapter follows, \label right after \begin -- so an
    equation labelled inside a theorem body is not mistaken for the theorem.
    An unlabelled statement cannot be referred to and so cannot be shared by
    reference; it is skipped rather than guessed at.
    """
    text = book_branch(strip_comments(text))
    out = []
    for m in BEGIN_RE.finditer(text):
        env = m.group(1)
        end = text.find(f'\\end{{{env}', m.end())
        body = text[m.end():end if end >= 0 else len(text)]
        label = LABEL_RE.search(body)
        if label:
            out.append((label.group(1).strip(), env))
    return out


def find_shared(chapter_texts, allow=()) -> dict[str, list[tuple[int, str, str]]]:
    """label -> [(chapter number, chapter id, environment)] for every label two
    or more chapters state a theorem under, minus the allowed exceptions."""
    where: dict[str, list[tuple[int, str, str]]] = {}
    for number, cid, text in chapter_texts:
        seen = set()
        for label, env in theorem_labels(text):
            if label in allow or label in seen:
                continue
            seen.add(label)
            where.setdefault(label, []).append((number, cid, env))
    return {label: sites for label, sites in sorted(where.items()) if len(sites) > 1}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--allow', action='append', default=[],
                    help='theorem label that may legitimately be stated in two chapters')
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

    total = sum(len(theorem_labels(t)) for _, _, t in texts)
    shared = find_shared(texts, set(args.allow))
    if not shared:
        print(f'ok: {total} labelled statements across {len(texts)} chapters, '
              f'no label stated in two ({len(args.allow)} allowed)')
        return 0

    print(f'-- {len(shared)} statement(s) printed twice in the Book, under two '
          f'numbers each:')
    for label, sites in shared.items():
        chs = ', '.join(f'ch.{n} {cid} ({env})' for n, cid, env in sites)
        print(f'     {label:<28} {chs}')
    print()
    print('   Two chapters each state a theorem under this label; the generator')
    print('   namespaces them apart so the Book compiles, and the reader meets')
    print('   the same statement twice with two numbers. Decide which chapter')
    print('   proves it, keep the statement there, and have the other refer to')
    print('   it -- \\ref{<owner prefix>:<label>} inside \\ifpdbook, with the')
    print('   standalone paper keeping its own copy in the \\else branch.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
