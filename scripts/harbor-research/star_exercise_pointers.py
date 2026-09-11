#!/usr/bin/env python3
"""star_exercise_pointers.py -- decide, from the sources, which exercise
pointers ride on a Recall block.

Every chapter section ends with an exercise pointer ("Exercises 4.13-4.19,
p. 195." in the margin) and many also end with a pdrecitation, whose Recall
block is raised to share the section's height. When both are present the
raised block prints over the pointer -- every margin-column collision
page_overflow.py found in the Book was this, seven pages of it, two with the
whole block on top of the pointer.

The fix is in pd-pedagogy.tex: a starred pointer (\\pdexercisepointer*) prints
nothing where it stands and becomes the Recall block's last line. This script
is the one place that decides which pointers are starred, so the decision is
a measurement and not a memory:

  * a pointer followed by \\begin{pdrecitation} before the next heading is
    starred;
  * a pointer that FOLLOWS a pdrecitation in the same section is moved to
    just before \\begin{pdrecitation} and starred (the block cannot consume
    a pointer issued after it);
  * every other pointer is left alone, and any star it carries is removed.

Idempotent. Run with --check to fail (exit 1) if the sources disagree with
what it would write, which is how library-checks keeps them honest.

usage: star_exercise_pointers.py [--check]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CHAPTERS = [
    "whitepaper/single-writer-kernel.tex",
    "whitepaper/legible-swarm.tex",
    "website-v2/public/whitepaper/anchor-protocol-whitepaper.tex",
    "website-v2/public/whitepaper/sealed-harbor.tex",
    "website-v2/public/whitepaper/spawn-to-person.tex",
    "website-v2/public/whitepaper/harbor-economy.tex",
    "website-v2/public/whitepaper/agent-transactions-whitepaper.tex",
    "website-v2/public/whitepaper/federated-harbor-whitepaper.tex",
]

POINTER = re.compile(r"^\\pdexercisepointer(one)?\*?\{.*$", re.M)
RECIT_BEGIN = re.compile(r"^\\begin\{pdrecitation\}", re.M)
RECIT_END = re.compile(r"^\\end\{pdrecitation\}", re.M)
HEADING = re.compile(r"^\\(?:section|subsection|chapter)\*?\{", re.M)


def unstar(line: str) -> str:
    return re.sub(r"^(\\pdexercisepointer(?:one)?)\*", r"\1", line)


def star(line: str) -> str:
    return re.sub(r"^(\\pdexercisepointer(?:one)?)\*?", r"\1*", line)


def rewrite(text: str) -> tuple[str, dict]:
    """Return the text as it should be, and counts of what changed."""
    lines = text.split("\n")
    kinds = []  # (index, 'P'|'RB'|'RE'|'H')
    for i, line in enumerate(lines):
        if POINTER.match(line):
            kinds.append((i, "P"))
        elif RECIT_BEGIN.match(line):
            kinds.append((i, "RB"))
        elif RECIT_END.match(line):
            kinds.append((i, "RE"))
        elif HEADING.match(line):
            kinds.append((i, "H"))

    starred = moved = plain = 0
    # Pass 1: pointers followed by a recitation before the next heading.
    for n, (i, k) in enumerate(kinds):
        if k != "P":
            continue
        following = next((kk for _, kk in kinds[n + 1:] if kk in ("RB", "H")), None)
        if following == "RB":
            lines[i] = star(lines[i]); starred += 1
        else:
            lines[i] = unstar(lines[i]); plain += 1

    # Pass 2: a pointer directly after \end{pdrecitation} in the same section
    # moves to just before its \begin{pdrecitation}, starred. Done on the
    # already-edited lines, back to front so indices stay valid.
    for n in range(len(kinds) - 1, 0, -1):
        i, k = kinds[n]
        if k != "P":
            continue
        # previous structural event must be the end of a recitation, with no
        # heading in between, and the pointer must currently be un-starred
        # (pass 1 left it plain because no recitation FOLLOWS it)
        prev = kinds[n - 1]
        if prev[1] != "RE":
            continue
        between = [ln for ln in lines[prev[0] + 1:i] if ln.strip()]
        if between:
            continue
        # find the matching \begin
        begin_idx = next(bi for bi, bk in reversed(kinds[:n]) if bk == "RB")
        pointer_line = star(lines[i])
        del lines[i]
        lines.insert(begin_idx, pointer_line)
        moved += 1; plain -= 1; starred += 1

    return "\n".join(lines), {"starred": starred, "moved": moved, "plain": plain}


def main() -> int:
    check = "--check" in sys.argv
    drift = 0
    totals = {"starred": 0, "moved": 0, "plain": 0}
    for rel in CHAPTERS:
        path = REPO / rel
        before = path.read_text(encoding="utf-8")
        after, counts = rewrite(before)
        for key in totals:
            totals[key] += counts[key]
        if after != before:
            drift += 1
            if check:
                print(f"{rel}: pointers do not match the measurement (run without --check)")
            else:
                path.write_text(after, encoding="utf-8")
                print(f"{rel}: starred {counts['starred']} (moved {counts['moved']}), plain {counts['plain']}")
    print(f"pointers: {totals['starred'] + totals['plain']}; starred {totals['starred']} "
          f"({totals['moved']} moved above their recitation), plain {totals['plain']}")
    if check and drift:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
