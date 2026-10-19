#!/usr/bin/env python3
r"""Chapter 1 promises never to write bare "delegation chain" again. This is the promise.

WHY THIS EXISTS. `whitepaper/single-writer-kernel.tex`'s subsection *Two
delegation chains, one dangerous name* splits one phrase into two objects --
the **authorization chain**, the cryptographic hop-bound attenuation-monotonic
chain of signatures that proves who authorized whom, and the **coordination
lineage**, the task graph over which loop detection and upward-block run -- and
closes with a sentence that is an invariant wearing prose clothing: "We never
again write bare ``delegation chain.''"

Nothing enforced it. When the Critical Analysis of 2026-09-08 charged the Book
with conflating the two, the charge was refuted where the reviewer aimed it
(chapter 1 makes the split, a month before the review) and true everywhere
else: bare uses survived in chapters 2, 4, 5, 7 and 8, and chapter 4 had
invented a third name, "delegation trace", for the object chapter 1 calls the
coordination lineage. A promise a chapter makes in its own voice and no
mechanism keeps is the defect class this check exists for.

WHAT COUNTS AS BARE. A *use* of the phrase to denote an object. Three things
are mentions rather than uses, and pass without being recorded:

  1. The phrase in LaTeX quotes -- ``delegation chain'' -- which is the chapter
     talking *about* the phrase, exactly what the defining subsection does.
  2. `two delegation chains`, which names the pair and so cannot conflate them.
  3. Anything inside an `lstlisting`, which is verbatim artifact source (a
     committed ProVerif model's own comment is not this Book's prose).

Everything else must resolve to `authorization chain` or `coordination
lineage`, or be recorded with `--allow <path>:<phrase>`. The four recorded
today are permanent editorial decisions rather than debt: two are a descriptive
genus used immediately after naming the object ("the authorization chain is a
hop-bound, attenuation-monotonic delegation chain of digital signatures"), and
two name a ProVerif query that pairs with the committed `chain-replay.pv`.

Exit 1 when a bare use exists. Deliberately brittle: an allow key carries the
exact phrase, so a *different* bare use in an already-excepted file still fails.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_duplicate_figures import chapters, strip_comments  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

PHRASE_RE = re.compile(r'delegation\s+chains?', re.I)
# ``...'' is TeX's double quote. The phrase may wrap a line inside the quotes.
QUOTED_RE = re.compile(r"``\s*delegation\s+chains?[.,]?\s*''", re.I)
PAIR_RE = re.compile(r'two\s+delegation\s+chains', re.I)
LSTLISTING_RE = re.compile(r'\\begin\{lstlisting\}.*?\\end\{lstlisting\}', re.S)

# The competing name chapter 4 used for the coordination lineage. One object,
# one name: this is the same defect as a bare "delegation chain", caught on the
# other side.
RIVAL_NAMES = ('delegation trace',)


def _mask(text: str) -> str:
    """Blank out spans that are mentions, not uses, keeping offsets stable."""
    out = text
    for rx in (LSTLISTING_RE, QUOTED_RE, PAIR_RE):
        out = rx.sub(lambda m: ' ' * (m.end() - m.start()), out)
    return out


def find_bare(paths, allow=()):
    """[(relative path, line, phrase, context)] for every bare use."""
    out = []
    for path in paths:
        if not path.is_file():
            continue
        rel = str(path.relative_to(REPO))
        raw = strip_comments(path.read_text(encoding='utf-8'))
        masked = _mask(raw)
        hits = [(m.start(), m.end(), m.group(0)) for m in PHRASE_RE.finditer(masked)]
        for name in RIVAL_NAMES:
            hits += [(m.start(), m.end(), m.group(0))
                     for m in re.finditer(re.escape(name), masked, re.I)]
        for start, end, found in sorted(hits):
            context = ' '.join(raw[max(0, start - 70):end + 70].split())
            # The suggested key: enough either side of the phrase to be unique
            # in its file, short enough to read in a workflow line.
            key = ' '.join(raw[max(0, start - 30):end + 30].split())
            if any(e.startswith(f'{rel}:')
                   and e[len(rel) + 1:].lower() in context.lower()
                   for e in allow):
                continue
            line = raw.count('\n', 0, start) + 1
            out.append((rel, line, key, context))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--allow', action='append', default=[],
                    help='<path>:<context> -- a use recorded as deliberate')
    args = ap.parse_args(argv)

    paths = [src for _, _, src in chapters()]
    found = find_bare(paths, set(args.allow))
    if not found:
        print(f'ok: {len(paths)} chapter(s), no bare "delegation chain" '
              f'({len(args.allow)} allowed)')
        return 0

    print(f'-- {len(found)} bare use(s) of a phrase chapter 1 promised to retire:')
    for rel, line, key, context in found:
        print(f'     {rel}:{line}')
        print(f'       ...{context}...')
        print(f'       allow key: {rel}:{key}')
    print()
    print('   Chapter 1 splits this phrase into two objects and says it will')
    print('   never write it bare again. Resolve each site to whichever it')
    print('   means -- "authorization chain" for the cryptographic token path,')
    print('   "coordination lineage" for the task graph loop detection walks --')
    print('   or record it with --allow if it is genuinely discussing the')
    print('   phrase rather than using it.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
