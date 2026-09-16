#!/usr/bin/env python3
r"""Every \begin{X} in the Book's sources has a matching \end{X}.

WHY THIS EXISTS. On 2026-09-08 the Book stopped compiling entirely -- no PDF,
in any edition -- because one table opened with \begin{tabularx} and closed
with \end{xltabular}. A conversion had changed one half and not the other.
TeX's report was "Argument of \TX@get@body has an extra }" at a generated line
number four hundred lines away from the actual defect, which is a diagnosis
only after you have already worked out what happened.

Three commits landed on top of that break before anyone noticed, each saying
"unbuilt" in its own subject line. The Book takes five to eight minutes to
compile, so a source edit that cannot possibly work is not discovered until
long after the next edit has been written against it. This check runs in well
under a second over the whole corpus and refuses that first commit.

It is deliberately NOT a TeX parser. It answers one question -- do the
environment names pair up -- because that is the question that was expensive
to answer the slow way. Brace balance is checked alongside it for the same
reason, with the one subtlety that bit the first draft of this script: the
line-break command \\ must be stripped BEFORE escaped braces, or "\\{" (a
break followed by an open brace, which appears in nearly every tikz label)
reads as an escaped \{ and a real brace is silently dropped. That produced two
confident false positives before it was caught.

Usage:
    python3 scripts/harbor-research/check_tex_environments.py            # the Book's corpus
    python3 scripts/harbor-research/check_tex_environments.py FILE ...   # named files

Exit 1 on any mismatch, naming the file, the environment, and the counts.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# Where the Book's sources live. Figure fragments are included: a fragment with
# an unpaired environment breaks the Book exactly as a chapter does.
CORPUS_GLOBS = (
    "whitepaper/*.tex",
    "whitepaper/figures/*.tex",
    "website-v2/public/whitepaper/*.tex",
    "website-v2/public/whitepaper/figures/*.tex",
)

BEGIN = re.compile(r"\\begin\s*\{([A-Za-z@*]+)\}")
END = re.compile(r"\\end\s*\{([A-Za-z@*]+)\}")
# A \newenvironment or \renewenvironment names an environment it does not open.
DEFINES = re.compile(r"\\(?:re)?newenvironment\s*\{([A-Za-z@*]+)\}")


def strip_comments(text: str) -> str:
    """Drop % comments, keeping \\% . Also drops the line-break command, so a
    later escaped-brace strip cannot mistake "\\\\{" for "\\{"."""
    out = []
    for raw in text.splitlines():
        out.append(re.sub(r"(?<!\\)%.*$", "", raw))
    return "\n".join(out)


def environment_counts(text: str) -> tuple[Counter, Counter]:
    body = strip_comments(text)
    return Counter(BEGIN.findall(body)), Counter(END.findall(body))


def brace_delta(text: str) -> int:
    body = strip_comments(text)
    body = body.replace("\\\\", "")          # the line-break command, first
    body = re.sub(r"\\[{}]", "", body)       # genuinely escaped braces
    return body.count("{") - body.count("}")


def check(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    # A path outside the repo (a scratch fixture, a file under test) is named
    # as given rather than crashing on relative_to.
    try:
        rel = path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        rel = path.as_posix()
    problems: list[str] = []

    begins, ends = environment_counts(text)
    defined = set(DEFINES.findall(strip_comments(text)))
    for name in sorted(set(begins) | set(ends)):
        if name in defined:
            continue  # a definition's own \begin/\end are the body, not a use
        b, e = begins.get(name, 0), ends.get(name, 0)
        if b != e:
            problems.append(
                f"{rel}: {name} opened {b}x, closed {e}x"
                + ("  (a conversion that changed one half?)" if b == 0 or e == 0 else "")
            )

    delta = brace_delta(text)
    if delta:
        problems.append(f"{rel}: braces net {delta:+d}")
    return problems


def corpus() -> list[Path]:
    files: list[Path] = []
    for pattern in CORPUS_GLOBS:
        files.extend(sorted(REPO.glob(pattern)))
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="specific .tex files (default: the Book's corpus)")
    args = ap.parse_args()

    paths = [Path(f) for f in args.files] if args.files else corpus()
    if not paths:
        print("::error::no .tex files to check -- this cannot pass having checked nothing", file=sys.stderr)
        return 1

    problems: list[str] = []
    for p in paths:
        if not p.is_file():
            print(f"::error::{p} is not a file", file=sys.stderr)
            return 1
        problems.extend(check(p))

    if problems:
        print(f"-- {len(problems)} unpaired environment(s) or unbalanced file(s):")
        for line in problems:
            print(f"  {line}")
        print("\nThe Book will not compile. TeX reports this as a brace or macro-argument")
        print("error at a generated line far from the edit, so fix it here instead.")
        return 1

    print(f"{len(paths)} source file(s): every environment pairs, every file balances")
    return 0


if __name__ == "__main__":
    sys.exit(main())
