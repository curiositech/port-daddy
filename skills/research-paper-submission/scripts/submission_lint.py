#!/usr/bin/env python3
"""submission_lint.py - mechanical pre-submission checks for a LaTeX paper.

Catches the class of defect that survives proofreading and dies in review:
dangling references, duplicate labels, citations with no bibitem, uncaptioned
figures, missing limitations sections, and unhedged superlative claims.

Every check here was run by hand during a real prior-art audit of seven papers
and caught something. The overclaim check in particular caught three false
statements that had survived multiple readings.

Usage:
    python3 submission_lint.py paper.tex [paper2.tex ...]
    python3 submission_lint.py paper.tex --figures-dir ../figures
    python3 submission_lint.py paper.tex --json

Exit codes: 0 clean or warnings only, 1 errors found, 2 bad invocation.

Deliberately dependency-free: stdlib only, runs anywhere Python 3.8+ does.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

# Words that in a formal paper are load-bearing promises rather than emphasis.
# Each is flagged for a human to confirm the proof actually delivers it. This is
# not a style check - "unbounded depth" in a paper whose proof gives logarithmic
# depth is a false statement, and it shipped past several careful readings.
OVERCLAIM = {
    # Tier 1: a mismatch here is a false statement, not a stylistic quibble.
    "unbounded": "does the proof give an unbounded quantity, or a finite/logarithmic one?",
    "provably not": "a negative existence claim - proved, or merely not exhibited?",
    "provably does not": "a negative existence claim - proved, or merely not exhibited?",
    "impossible": "impossible, or merely not achievable by the mechanisms considered?",
    "uniquely": "uniqueness proved, or just one witness exhibited?",
    "optimal": "optimal over what class, under what constraint set?",
    # Tier 2: quantifier scope. Usually fine, occasionally hiding an unstated domain.
    "for all": "quantified over what domain? is the domain stated in the theorem?",
    "in every": "quantified over what domain?",
    "no signal exists": "no signal, or no *costless* signal?",
    # Tier 3: biconditionals. Common and usually correct in formal work, so these
    # are summarised rather than listed one by one - but the degenerate case
    # (empty set, zero, single element) is where a real 'iff' most often fails.
    "if and only if": "both directions proved? check the degenerate cases (empty, zero, singleton)",
    "iff": "both directions proved? check the degenerate cases (empty, zero, singleton)",
}

# Phrases common enough in formal writing that per-occurrence reporting is noise.
# Reported once with a count and line list instead.
SUMMARISE_ONLY = {"iff", "if and only if", "for all", "in every"}

# Sections that referees look for and whose absence reads as evasion.
EXPECTED_SECTIONS = {
    "related work": ("related work", "prior art", "related literature"),
    "limitations": ("limitation", "honest boundary", "boundary", "threats to validity",
                    "what this does not", "scope", "caveat"),
}


@dataclass
class Finding:
    severity: str          # "error" | "warn" | "info"
    check: str
    message: str
    file: str = ""
    line: int = 0

    def render(self) -> str:
        loc = f"{self.file}:{self.line}" if self.line else self.file
        tag = {"error": "ERROR", "warn": "warn ", "info": "info "}[self.severity]
        return f"  [{tag}] {loc}: {self.message}" if loc else f"  [{tag}] {self.message}"


@dataclass
class Doc:
    path: Path
    raw: str
    stripped: str                      # comments and verbatim removed
    labels: set = field(default_factory=set)
    dup_labels: list = field(default_factory=list)


def strip_noise(src: str) -> str:
    """Remove comments and verbatim blocks.

    Doing this properly is the whole game for brace counting. A naive counter
    that ignores comments reports phantom imbalances on files that compile
    perfectly - a real false positive that cost an hour of investigation.
    A '%' preceded by a backslash is a literal percent, not a comment.
    """
    out = []
    for line in src.split("\n"):
        cut = None
        i = 0
        while i < len(line):
            if line[i] == "\\":
                i += 2               # skip escaped char, including \% and \\
                continue
            if line[i] == "%":
                cut = i
                break
            i += 1
        out.append(line if cut is None else line[:cut])
    text = "\n".join(out)
    # Verbatim-like environments contain arbitrary braces; blank them out.
    for env in ("verbatim", "lstlisting", "minted", "Verbatim"):
        text = re.sub(rf"\\begin{{{env}}}.*?\\end{{{env}}}", "", text, flags=re.S)
    return text


def load(path: Path) -> Doc:
    raw = path.read_text(encoding="utf-8", errors="replace")
    return Doc(path=path, raw=raw, stripped=strip_noise(raw))


def collect_labels(doc: Doc) -> None:
    found = re.findall(r"\\label\{([^}]*)\}", doc.stripped)
    doc.labels = set(found)
    doc.dup_labels = sorted({l for l in found if found.count(l) > 1})


def line_of(doc: Doc, needle: str) -> int:
    idx = doc.stripped.find(needle)
    return doc.stripped.count("\n", 0, idx) + 1 if idx >= 0 else 0


def count_braces(text: str) -> int:
    """Net brace depth, handling LaTeX escapes correctly.

    The obvious implementation - text.replace(r'\\{','').replace(r'\\}','')
    then count - is WRONG, and wrong in a way that produces confident false
    positives on files that compile. In the sequence '\\\\{' (a line break
    followed by a real opening brace) the naive replace matches the *second*
    backslash with the brace and eats it, reporting a phantom imbalance.

    Walk the string instead: on a backslash, skip the next character whatever
    it is. That consumes '\\\\' as a unit and leaves the following brace to be
    counted, which is what TeX does.
    """
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2                    # escaped pair: \{ \} \\ \% all consumed whole
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    return depth


def check_structure(doc: Doc) -> list:
    """Braces and environments, on comment-stripped text."""
    out = []
    delta = count_braces(doc.stripped)
    if delta:
        out.append(Finding("error", "braces",
                           f"unbalanced braces: {delta:+d} (excess {'open' if delta > 0 else 'close'})",
                           doc.path.name))
    begins = re.findall(r"\\begin\{([^}]*)\}", doc.stripped)
    ends = re.findall(r"\\end\{([^}]*)\}", doc.stripped)
    for env in sorted(set(begins) | set(ends)):
        b, e = begins.count(env), ends.count(env)
        if b != e:
            out.append(Finding("error", "environments",
                               f"\\begin{{{env}}} x{b} but \\end{{{env}}} x{e}", doc.path.name))
    for lbl in doc.dup_labels:
        out.append(Finding("error", "duplicate-label",
                           f"\\label{{{lbl}}} defined more than once - \\ref will resolve to the wrong one",
                           doc.path.name, line_of(doc, f"\\label{{{lbl}}}")))
    return out


def check_citations(doc: Doc, extra_keys: set) -> list:
    out = []
    cited = set()
    for m in re.finditer(r"\\cite[tp]?\*?(?:\[[^\]]*\])*\{([^}]*)\}", doc.stripped):
        cited.update(k.strip() for k in m.group(1).split(",") if k.strip())
    defined = set(re.findall(r"\\bibitem(?:\[[^\]]*\])?\{([^}]*)\}", doc.stripped)) | extra_keys
    for key in sorted(cited - defined):
        out.append(Finding("error", "dangling-cite",
                           f"\\cite{{{key}}} has no \\bibitem and no .bib entry",
                           doc.path.name, line_of(doc, key)))
    # Unused bibitems are a padding smell, not an error.
    for key in sorted(defined - cited - extra_keys):
        out.append(Finding("warn", "unused-bibitem",
                           f"\\bibitem{{{key}}} is never cited - padding, or a lost \\cite?",
                           doc.path.name))
    if not cited:
        out.append(Finding("warn", "no-citations", "no \\cite commands found at all", doc.path.name))
    return out


def check_refs(doc: Doc, known_labels: set) -> list:
    out = []
    refs = set()
    for m in re.finditer(r"\\(?:page|auto|c|C)?ref\*?\{([^}]*)\}", doc.stripped):
        refs.update(k.strip() for k in m.group(1).split(",") if k.strip())
    for key in sorted(refs - known_labels):
        out.append(Finding("error", "dangling-ref",
                           f"\\ref{{{key}}} has no matching \\label (checked this file and --figures-dir)",
                           doc.path.name, line_of(doc, key)))
    return out


def check_figures(doc: Doc) -> list:
    out = []
    for m in re.finditer(r"\\begin\{(figure|table)\*?\}(.*?)\\end\{\1\*?\}", doc.stripped, flags=re.S):
        kind, body = m.group(1), m.group(2)
        ln = doc.stripped.count("\n", 0, m.start()) + 1
        if "\\caption" not in body:
            out.append(Finding("error", "uncaptioned",
                               f"{kind} with no \\caption", doc.path.name, ln))
        else:
            cap = re.search(r"\\caption\{(.*?)\}\s*(?:\\label|\n\n|$)", body, flags=re.S)
            if cap and len(cap.group(1).split()) < 8:
                out.append(Finding("warn", "thin-caption",
                                   f"{kind} caption is under 8 words - a caption should let the "
                                   f"figure be read without the body text", doc.path.name, ln))
        if "\\label" not in body:
            out.append(Finding("warn", "unlabelled-float",
                               f"{kind} has no \\label, so it cannot be \\ref'd", doc.path.name, ln))
    return out


def check_sections(doc: Doc) -> list:
    out = []
    heads = " ".join(re.findall(r"\\(?:sub)*section\*?\{([^}]*)\}", doc.stripped)).lower()
    body_lower = doc.stripped.lower()
    for name, needles in EXPECTED_SECTIONS.items():
        if not any(n in heads for n in needles):
            # a boundary/limitations environment counts even without a heading
            if name == "limitations" and any(n in body_lower for n in needles):
                continue
            out.append(Finding("warn", "missing-section",
                               f"no section resembling '{name}' - referees look for this and "
                               f"its absence reads as evasion", doc.path.name))
    if "\\begin{abstract}" not in doc.stripped:
        out.append(Finding("warn", "no-abstract", "no abstract environment found", doc.path.name))
    else:
        m = re.search(r"\\begin\{abstract\}(.*?)\\end\{abstract\}", doc.stripped, flags=re.S)
        if m:
            n = len(m.group(1).split())
            if n < 60:
                out.append(Finding("warn", "thin-abstract",
                                   f"abstract is {n} words - most venues expect 150-250",
                                   doc.path.name))
            elif n > 400:
                out.append(Finding("warn", "long-abstract",
                                   f"abstract is {n} words - most venues cap around 250",
                                   doc.path.name))
    return out


def check_overclaims(doc: Doc) -> list:
    """Flag promises whose proof must be checked to match.

    Grouped by phrase: a paper about biconditionals contains many honest 'iff's,
    and listing each one buries the one that matters. Phrases in SUMMARISE_ONLY
    get a single line with a count; the rest get an excerpt each, because for
    those the surrounding words are what tell you whether the claim is real.
    """
    out = []
    low = doc.stripped.lower()
    for phrase, question in OVERCLAIM.items():
        hits = list(re.finditer(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", low))
        if not hits:
            continue
        lines = [doc.stripped.count("\n", 0, m.start()) + 1 for m in hits]
        if phrase in SUMMARISE_ONLY:
            shown = ", ".join(str(l) for l in lines[:12])
            more = f" (+{len(lines) - 12} more)" if len(lines) > 12 else ""
            out.append(Finding("info", "overclaim",
                               f"'{phrase}' x{len(hits)} at lines {shown}{more} - {question}",
                               doc.path.name, lines[0]))
        else:
            for m, ln in zip(hits, lines):
                span = doc.stripped[max(0, m.start() - 60):m.start() + 60].replace("\n", " ")
                out.append(Finding("info", "overclaim",
                                   f"'{phrase}' - {question}\n           ...{span.strip()}...",
                                   doc.path.name, ln))
    return out


def run(paths, figures_dir: Path | None, bib_keys: set):
    docs = [load(p) for p in paths]
    for d in docs:
        collect_labels(d)

    known = set()
    for d in docs:
        known |= d.labels
    if figures_dir and figures_dir.is_dir():
        for f in sorted(figures_dir.glob("*.tex")):
            known |= set(re.findall(r"\\label\{([^}]*)\}", strip_noise(
                f.read_text(encoding="utf-8", errors="replace"))))

    findings = []
    for d in docs:
        findings += check_structure(d)
        findings += check_citations(d, bib_keys)
        findings += check_refs(d, known)
        findings += check_figures(d)
        findings += check_sections(d)
        findings += check_overclaims(d)
    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tex", nargs="+", type=Path)
    ap.add_argument("--figures-dir", type=Path, default=None,
                    help="directory of \\input-ed figure .tex files, so their \\labels count as defined")
    ap.add_argument("--bib", type=Path, default=None, help="optional .bib file supplying citation keys")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--quiet-info", action="store_true", help="suppress overclaim prompts")
    args = ap.parse_args()

    missing = [p for p in args.tex if not p.is_file()]
    if missing:
        print(f"no such file: {', '.join(str(m) for m in missing)}", file=sys.stderr)
        return 2

    bib_keys = set()
    if args.bib and args.bib.is_file():
        bib_keys = set(re.findall(r"@\w+\s*\{\s*([^,\s]+)",
                                  args.bib.read_text(encoding="utf-8", errors="replace")))

    findings = run(args.tex, args.figures_dir, bib_keys)
    if args.quiet_info:
        findings = [f for f in findings if f.severity != "info"]

    if args.json:
        print(json.dumps([asdict(f) for f in findings], indent=2))
    else:
        errors = [f for f in findings if f.severity == "error"]
        warns = [f for f in findings if f.severity == "warn"]
        infos = [f for f in findings if f.severity == "info"]
        for title, group in (("ERRORS - these break the build or mislead the reader", errors),
                             ("WARNINGS - a referee will notice", warns),
                             ("CLAIMS TO CONFIRM - not defects, questions to answer", infos)):
            if group:
                print(f"\n{title}")
                for f in group:
                    print(f.render())
        print(f"\n{len(errors)} error(s), {len(warns)} warning(s), {len(infos)} claim(s) to confirm")
        if not findings:
            print("clean.")
    return 1 if any(f.severity == "error" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
