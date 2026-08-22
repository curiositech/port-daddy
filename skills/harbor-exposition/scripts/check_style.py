#!/usr/bin/env python3
"""Done-test linter for the seven-moves house style.

Usage: python3 check_style.py <draft.md | draft.tex>
Checks (case-insensitive): express lane, one-breath line, the box, the
"Now you try" fade, misread-to-preempt, honest boundary, provenance tags.
Exit code 1 if any required check fails.
"""
import re, sys

CHECKS = [
    ("express lane",        r"express lane",                         True),
    ("one-breath line",     r"(one breath|idea in one breath)",      True),
    ("the box",             r"(^> \*\*|\\begin\{thebox\})",          True),
    ("worked-example fade", r"now you try",                          True),
    ("misread preempted",   r"misread",                              False),
    ("honest boundary",     r"(honest boundary|\\begin\{boundary\})",True),
    ("provenance tags",     r"\[(verified|internal)",                True),
]

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(2)
    text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
    failed = 0
    for name, pat, required in CHECKS:
        hit = re.search(pat, text, re.IGNORECASE | re.MULTILINE)
        status = "PASS" if hit else ("FAIL" if required else "warn (waive consciously)")
        if required and not hit: failed += 1
        print(f"  [{status:>4}] {name}")
    print("done-tests:", "PASS" if failed == 0 else f"{failed} required check(s) missing")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
