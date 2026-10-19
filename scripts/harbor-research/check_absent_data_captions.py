#!/usr/bin/env python3
r"""No figure caption tells the reader that the data behind the figure is absent.

WHY THIS EXISTS. The Critical Analysis of 2026-09-08 caught Figure 4.5 saying,
in its own caption, "The committed sweep CSV (r1-floor.csv) is not yet present,
so the two curves are the chapter's own closed-form Floor formula rather than
simulated points." The honesty is the right instinct and the caption is not the
right home for it: a reader who skims the plot reads a measured-looking curve,
and a caption sentence is the only thing standing between that and a claim the
Book cannot support. The fix is to commit the data and delete the sentence, and
the adjudication of that review ordered exactly this guard alongside it, so that
the next figure drawn ahead of its data cannot quietly ship the same apology.

WHAT IT READS. Every \caption in the eight chapter sources and in the two figure
fragment directories, Book branch and standalone branch alike -- a caption in
the \else branch reaches a reader of the standalone paper, so both sides count
here, unlike the duplicate-drawing checks where only the Book can be wrong.

Exit 1 when such a caption exists. `--allow <path>:<phrase>` records a caption
that is waiting on its data, so the debt is visible in the workflow rather than
in a reader's caption, and a *second* such caption in the same file still fails.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_duplicate_figures import FIGURE_DIRS, chapters, strip_comments  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

# Phrases that say the artifact behind the drawing does not exist. Deliberately
# a short closed list of things a caption actually said or would say, not a
# cleverness: a wide net here would catch honest boundary prose ("the sweep does
# not cover heavy-tailed service"), which is the sentence the Book wants.
ABSENT_PHRASES = (
    'not committed',
    'not yet committed',
    'not yet present',
    'is not in the tree',
    'does not exist yet',
    'has not been run',
    'not yet measured',
)

CAPTION_RE = re.compile(r'\\caption\*?\s*(?:\[[^\]]*\])?\s*\{')


def captions(text: str):
    """(line number, caption text) for each \\caption, braces balanced.

    A caption carries \\texttt{}, math and \\ref{} freely, so the closing brace
    has to be found by counting rather than by the first `}`.
    """
    text = strip_comments(text)
    for m in CAPTION_RE.finditer(text):
        depth, i, n = 1, m.end(), len(text)
        while i < n and depth:
            ch = text[i]
            if ch == '\\':
                i += 2
                continue
            depth += (ch == '{') - (ch == '}')
            i += 1
        yield text.count('\n', 0, m.start()) + 1, text[m.end():i - 1]


def sources():
    """Every file whose captions a reader of the Book or of a standalone paper
    can meet: the chapter bodies and the figure fragments they input."""
    seen = []
    for _, _, src in chapters():
        if src.is_file():
            seen.append(src)
    for d in FIGURE_DIRS:
        if d.is_dir():
            seen.extend(sorted(d.glob('*.tex')))
    return seen


def find_absent(paths, allow=()):
    """[(relative path, line, phrase, caption)] for every caption that tells the
    reader its data is absent, minus the recorded exceptions."""
    out = []
    for path in paths:
        rel = str(path.relative_to(REPO))
        for line, caption in captions(path.read_text(encoding='utf-8')):
            flat = ' '.join(caption.split()).lower()
            for phrase in ABSENT_PHRASES:
                if phrase in flat and f'{rel}:{phrase}' not in allow:
                    out.append((rel, line, phrase, ' '.join(caption.split())))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--allow', action='append', default=[],
                    help='<path>:<phrase> -- a caption waiting on its data')
    args = ap.parse_args(argv)

    paths = sources()
    found = find_absent(paths, set(args.allow))
    if not found:
        print(f'ok: {len(paths)} source(s), no caption says its data is absent '
              f'({len(args.allow)} allowed)')
        return 0

    print(f'-- {len(found)} caption(s) telling the reader the data behind the figure is absent:')
    for rel, line, phrase, caption in found:
        print(f'     {rel}:{line}  "{phrase}"')
        print(f'       {caption[:150]}')
        print(f'       allow key: {rel}:{phrase}')
    print()
    print('   Commit the data the figure is drawn from and delete the sentence,')
    print('   or redraw the figure as the analytic curve it actually is and say')
    print('   so in the caption without promising a measurement. A caption is')
    print('   not where a missing artifact should be recorded.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
