#!/usr/bin/env python3
r"""A Book-side edit cannot quietly shrink a submission paper.

WHY THIS EXISTS. harbor-economy.tex is a chapter of the Book and, in the same
bytes, the source of harbor-economy-whitepaper.pdf, a standalone submission
paper. Every chapter source is such a twin. Resolving the Book's duplicated
drawings, an edit to chapter 6 rewrote five figure sites to point at the
chapters that own them -- correct for the Book, and it removed five figures
from the standalone paper, which has no other chapter to point at. Nothing
caught it. The PDF regen commit shrank by 50 KB and three pages, and someone
read it.

\ifpdbook is the source's way of diverging: the Book takes the true branch, the
paper takes the \else. This check reads the \else side -- what each standalone
paper actually compiles -- and counts its figure sites: every \input{figures/...}
that is a drawing rather than shared apparatus, and every figure and table
environment written inline. The counts are compared with a committed record,
whitepaper/standalone-figures.json, and any difference fails. A site the paper
lost is reported as exactly that. A site it gained is reported too, because the
record is then stale and `--write` refreshes it -- the point is that a change to
a submission paper's figures is a deliberate act with a diff in the record,
never a side effect of editing the Book.

Apparatus is identified the way check_duplicate_figures.py identifies it,
transitively from the Book preamble's own inputs, so that a palette or a
pedagogy file every chapter loads is not mistaken for a drawing.

    python3 scripts/harbor-research/check_standalone_figures.py           # check
    python3 scripts/harbor-research/check_standalone_figures.py --write   # refresh the record

Exit 1 on any difference from the record, or a record that does not name
every chapter textbook.json does.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_duplicate_figures import (  # noqa: E402
    INPUT_RE, REPO, apparatus, chapters, standalone_branch, strip_comments,
)

RECORD = REPO / 'whitepaper/standalone-figures.json'
INLINE_RE = re.compile(r'\\begin\{(figure|table)\*?\}')


def survey(text: str, skip: set[str] = frozenset()) -> dict:
    """What one standalone paper compiles: its drawing inputs (sorted, so the
    record diffs line by line) and its inline figure and table environments."""
    paper = standalone_branch(strip_comments(text))
    inputs = sorted({name for name in INPUT_RE.findall(paper) if name not in skip})
    kinds = INLINE_RE.findall(paper)
    return {
        'inputs': inputs,
        'inline_figures': kinds.count('figure'),
        'inline_tables': kinds.count('table'),
    }


def compare(expected: dict, actual: dict) -> list[str]:
    """Human-readable differences for one paper; empty when they agree."""
    out = []
    lost = sorted(set(expected.get('inputs', [])) - set(actual['inputs']))
    gained = sorted(set(actual['inputs']) - set(expected.get('inputs', [])))
    for name in lost:
        out.append(f'lost   \\input{{figures/{name}}} -- the paper no longer prints it')
    for name in gained:
        out.append(f'gained \\input{{figures/{name}}} -- not in the record yet')
    for key in ('inline_figures', 'inline_tables'):
        was, now = expected.get(key, 0), actual[key]
        if was != now:
            word = 'lost' if now < was else 'gained'
            out.append(f'{word:<6} {abs(now - was)} inline {key.split("_")[1]} '
                       f'(record {was}, source {now})')
    return out


def survey_all() -> dict[str, dict]:
    skip = apparatus()
    found = {}
    for _number, cid, src in chapters():
        if src.is_file():
            found[cid] = {'source': str(src.relative_to(REPO)), **survey(src.read_text(encoding='utf-8'), skip)}
    return found


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--write', action='store_true',
                    help='refresh the record from the sources instead of checking against it')
    args = ap.parse_args(argv)

    found = survey_all()
    if args.write:
        record = {
            '_comment': (
                'Figure sites each STANDALONE paper compiles -- the \\else side of every '
                '\\ifpdbook in its twin-source chapter. Checked by scripts/harbor-research/'
                'check_standalone_figures.py; refresh with --write when a paper\'s figures '
                'change on purpose. A row that shrinks without such a commit is a Book-side '
                'edit that took a figure out of a submission paper.'
            ),
            'papers': found,
        }
        RECORD.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
        sites = sum(len(p['inputs']) + p['inline_figures'] + p['inline_tables'] for p in found.values())
        print(f'wrote {RECORD.relative_to(REPO)}: {len(found)} papers, {sites} figure sites')
        return 0

    if not RECORD.is_file():
        print(f'-- no record at {RECORD.relative_to(REPO)}; run with --write to create it')
        return 1
    expected = json.loads(RECORD.read_text(encoding='utf-8')).get('papers', {})

    problems: dict[str, list[str]] = {}
    for cid in sorted(set(expected) | set(found)):
        if cid not in expected:
            problems[cid] = ['not in the record -- run --write after checking the paper is right']
        elif cid not in found:
            problems[cid] = ['in the record but textbook.json names no such chapter']
        else:
            diff = compare(expected[cid], found[cid])
            if diff:
                problems[cid] = diff

    if not problems:
        sites = sum(len(p['inputs']) + p['inline_figures'] + p['inline_tables'] for p in found.values())
        print(f'ok: {len(found)} standalone papers, {sites} figure sites, all as recorded')
        return 0

    print(f'-- {len(problems)} standalone paper(s) differ from {RECORD.relative_to(REPO)}:')
    for cid, lines in problems.items():
        print(f'   {cid}')
        for line in lines:
            print(f'     {line}')
    print()
    print('   Each chapter source is also a submission paper. A site marked lost')
    print('   means a Book-side edit took a figure out of that paper; if the Book')
    print('   should not print it, put the \\input in the \\else branch of an')
    print('   \\ifpdbook so the paper keeps it. If the change to the paper is')
    print('   intended, refresh the record with --write and commit both.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
