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

THE SECOND CHECK: a root document must load what its figures need. On
2026-09-14 two pgfplots figures were \input into agent-transactions-
whitepaper.tex, whose preamble loads tikz but not pgfplots. The Book compiled
-- the mega-volume preamble loads pgfplots for the sealed room's figures -- so
nothing looked wrong until the standalone chapter build died on "Environment
axis undefined" and took the artifact-consuming job down with it. Every
environment paired; the file was balanced; the first check had nothing to say.
The package a fragment needs is not visible in the fragment, and the preamble
that must supply it is in a different file, so this is precisely the kind of
defect nobody sees by reading either half.

So for each root document (anything with a \documentclass) this resolves the
transitive \input/\include closure, and refuses a root whose closure uses an
environment that only a package supplies unless that package is loaded
somewhere in the same closure. The table of requirements is deliberately
short: it lists what has actually bitten, not every package in TeX Live.

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

DOCUMENTCLASS = re.compile(r"\\documentclass\s*(?:\[[^\]]*\])?\s*\{")
# \usepackage[opt]{a,b,c} -- the optional argument may itself contain braces
# (\usepackage[font={small}]{caption}), so the class is "not ]" up to the last.
USEPACKAGE = re.compile(r"\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}")
INPUT = re.compile(r"\\(?:input|include)\s*\{([^}]*)\}")

# What a fragment can use that its own file cannot supply. Keep this list to
# what has actually broken a build: a speculative entry that fires on a
# correct document teaches everyone to pass --no-verify.
ENVIRONMENT_PACKAGES = {
    "axis": "pgfplots",
    "groupplot": "pgfplots",
    "semilogxaxis": "pgfplots",
    "semilogyaxis": "pgfplots",
    "loglogaxis": "pgfplots",
    "polaraxis": "pgfplots",
    "tikzpicture": "tikz",
}
# Loading the key implies the values: pgfplots loads tikz, tikz loads pgf.
PACKAGE_IMPLIES = {
    "pgfplots": {"tikz", "pgf"},
    "tikz": {"pgf"},
}


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


def resolve_input(name: str, root_dir: Path) -> Path | None:
    r"""\input{figures/fig-x} -> the file it names, or None if it is not on disk.

    A missing \input is TeX's problem to report, not this check's: the file may
    be generated at build time. Silence here, a build error there.
    """
    name = name.strip()
    if not name:
        return None
    for candidate in (root_dir / name, root_dir / (name + ".tex")):
        if candidate.is_file():
            return candidate
    return None


def closure(root: Path) -> list[Path]:
    r"""The root and every file it reaches through \input/\include.

    Depth-first with a visited set, so a preamble included from two places is
    read once and a cycle cannot hang the check.
    """
    seen: set[Path] = set()
    order: list[Path] = []
    stack = [root.resolve()]
    while stack:
        current = stack.pop()
        if current in seen or not current.is_file():
            continue
        seen.add(current)
        order.append(current)
        body = strip_comments(current.read_text(encoding="utf-8", errors="replace"))
        for name in INPUT.findall(body):
            found = resolve_input(name, current.parent)
            if found is not None:
                stack.append(found.resolve())
    return order


def packages_loaded(text: str) -> set[str]:
    names: set[str] = set()
    for group in USEPACKAGE.findall(text):
        for name in group.split(","):
            name = name.strip()
            if name:
                names.add(name)
    for name in list(names):
        names |= PACKAGE_IMPLIES.get(name, set())
    return names


def check_root_provides(root: Path) -> list[str]:
    r"""A root document loads every package the environments in its closure need."""
    files = closure(root)
    loaded: set[str] = set()
    used: dict[str, Path] = {}
    for path in files:
        body = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
        loaded |= packages_loaded(body)
        defined = set(DEFINES.findall(body))
        for name in BEGIN.findall(body):
            if name in ENVIRONMENT_PACKAGES and name not in defined:
                used.setdefault(name, path)

    try:
        rel_root = root.resolve().relative_to(REPO).as_posix()
    except ValueError:
        rel_root = root.as_posix()

    problems: list[str] = []
    for env in sorted(used):
        package = ENVIRONMENT_PACKAGES[env]
        if package in loaded:
            continue
        source = used[env]
        try:
            rel_src = source.resolve().relative_to(REPO).as_posix()
        except ValueError:
            rel_src = source.as_posix()
        where = "its own body" if source.resolve() == root.resolve() else f"\\input {rel_src}"
        problems.append(
            f"{rel_root}: uses \\begin{{{env}}} (from {where}) but no \\usepackage{{{package}}} "
            f"in its preamble  (TeX will say \"Environment {env} undefined\")"
        )
    return problems


def roots(paths: list[Path]) -> list[Path]:
    """The compilable documents among these files: those with a \\documentclass."""
    found = []
    for path in paths:
        if not path.is_file():
            continue
        head = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
        if DOCUMENTCLASS.search(head):
            found.append(path)
    return found


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

    missing: list[str] = []
    document_roots = roots(paths)
    for root in document_roots:
        missing.extend(check_root_provides(root))

    if problems:
        print(f"-- {len(problems)} unpaired environment(s) or unbalanced file(s):")
        for line in problems:
            print(f"  {line}")
        print("\nThe Book will not compile. TeX reports this as a brace or macro-argument")
        print("error at a generated line far from the edit, so fix it here instead.")
    if missing:
        print(f"-- {len(missing)} root document(s) missing a package their figures need:")
        for line in missing:
            print(f"  {line}")
        print("\nThe fragment cannot load its own package, and the preamble that must")
        print("supply it is a different file. Add the \\usepackage to the root's preamble.")
    if problems or missing:
        return 1

    print(f"{len(paths)} source file(s): every environment pairs, every file balances")
    print(f"{len(document_roots)} root document(s): each loads the packages its figures need")
    return 0


if __name__ == "__main__":
    sys.exit(main())
