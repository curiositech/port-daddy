#!/usr/bin/env python3
"""check_citations.py — unified citation verification for the Harbor Research
and Coordination Papers LaTeX corpora.

Born from a pd-spider review comment on PR #9856 ("a unified citation
verification tool can cross-reference deep-dive findings, arXiv metadata, and
paper citations to flag discrepancies") and from the real bug fixed in commit
1cf3a3226 (a citation named in prose with no matching \\bibitem). Stdlib-only,
offline, reproducible — no arXiv/DOI network lookups.

Corpora (three LaTeX bibliographies, all `thebibliography`/`\\bibitem`/`\\cite`,
not BibTeX):
  1. docs/harbor-research/tex/*.tex       — the Harbor Research Program papers
  2. whitepaper/*.tex                     — Coordination Papers chapters (subset)
  3. website-v2/public/whitepaper/*.tex   — Coordination Papers chapters (rest)
                                             + the mega-volume assembly files

Each corpus directory is globbed non-recursively (`*.tex` only) so the file
list can't go stale — adding paper8.tex or a new chapter needs no edit here.
Figure snippets living in `*/figures/*.tex` are NOT globbed directly (they are
not standalone compilable documents); instead each top-level file's `\\input`/
`\\include` directives are resolved recursively so a `\\cite` inside an
included figure is checked against the *including* document's bibliography,
matching what pdflatex actually does. Paths under `.claude/worktrees/` are
always excluded.

Checks:
  1. Inventory  — every \\bibitem and \\cite in scope (--verbose only).
  2. Orphaned bibitem — a \\bibitem{key} defined in a document but never
     \\cite'd anywhere in that same compiled document. (The B9 pattern named
     in CROSS-DOCUMENT-SYNTHESIS.md: dead reference cruft.)
  3. Dangling cite — a \\cite{key} used in a document with no matching
     \\bibitem{key} in that document's own bibliography. (The class of bug
     fixed for real in 1cf3a3226.)
  4. Confidence-register cross-check — for every live \\bibitem (one that IS
     \\cite'd, i.e. actually in use, not just orphaned text) across all three
     corpora, look for a plausible fuzzy match (shared 4-digit year + at least
     two shared distinctive words) against a candidate row in
     docs/harbor-research/deep-dives/BIBLIOGRAPHY.md's Part 1 tables, then
     check the four deep-dive findings.md files for a verdict that overrides
     BIBLIOGRAPHY.md (findings.md wins on conflict — it may be more current).
     Flag any match whose resolved confidence is not `verified`. This is
     heuristic text matching, printed with its evidence so a human can verify
     — never treated as ground truth, and never affects the exit code.

Exit status: 0 unless check 2 or check 3 found something (check 4 is always
advisory, per the task: the matching is fuzzy and a clean run is expected).

Usage:
    python3 scripts/harbor-research/check_citations.py [--verbose]
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys
from dataclasses import dataclass, field

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CORPUS_PATTERNS = [
    "docs/harbor-research/tex/*.tex",
    "whitepaper/*.tex",
    "website-v2/public/whitepaper/*.tex",
]

BIBLIOGRAPHY_MD = "docs/harbor-research/deep-dives/BIBLIOGRAPHY.md"
FINDINGS_GLOB = "docs/harbor-research/deep-dives/flag-*/findings.md"

WORKTREE_MARKER = os.path.join(".claude", "worktrees")

INPUT_RE = re.compile(r"\\(?:input|include)\{([^}]+)\}")
BIBITEM_RE = re.compile(r"\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}")
CITE_RE = re.compile(r"\\cite(?:\[[^\]]*\])?\{([^}]+)\}")
YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")

# Words too generic to count as a "distinctive shared word" for check 4 — mostly
# venue/bibliographic scaffolding that appears in nearly every citation.
STOPWORDS = {
    "the", "and", "for", "with", "from", "into", "about", "over", "under",
    "journal", "proceedings", "transactions", "conference", "press", "review",
    "science", "sciences", "systems", "system", "theory", "logic", "logics",
    "information", "security", "economic", "economics", "computer", "computing",
    "volume", "pages", "annual", "symposium", "workshop", "acm", "ieee", "arxiv",
    "working", "paper", "papers", "vol", "no", "pp", "letters", "applied",
    "management", "policy", "policies", "analysis", "control", "practice",
    "theoretical", "international", "national", "using", "based", "toward",
    "towards", "study", "studies", "approach", "approaches", "design",
}


def is_excluded(path: str) -> bool:
    # Match the marker against the path relative to the repo root, so a checkout
    # that is itself an agent worktree under .claude/worktrees/ still scans its
    # own corpus instead of excluding everything.
    return WORKTREE_MARKER in os.path.relpath(path, REPO_ROOT)


def discover_corpus_files() -> list[str]:
    files: list[str] = []
    for pattern in CORPUS_PATTERNS:
        for path in sorted(glob.glob(os.path.join(REPO_ROOT, pattern))):
            if os.path.isfile(path) and not is_excluded(path):
                files.append(path)
    return files


def rel(path: str) -> str:
    return os.path.relpath(path, REPO_ROOT)


def strip_comments(line: str) -> str:
    """Strip a LaTeX `%` comment, respecting escaped `\\%`."""
    out = []
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        if ch == "%" and (i == 0 or line[i - 1] != "\\"):
            break
        out.append(ch)
        i += 1
    return "".join(out)


def split_keys(raw: str) -> list[str]:
    return [k.strip() for k in raw.split(",") if k.strip()]


@dataclass
class BibItem:
    key: str
    file: str  # repo-relative
    line: int
    raw_text: str  # bibitem entry body, comment-stripped, joined across lines


@dataclass
class CiteUse:
    key: str
    file: str  # repo-relative
    line: int


@dataclass
class Document:
    """One compiled document: a top-level corpus file plus everything it pulls
    in via \\input/\\include, recursively."""

    top_file: str  # repo-relative
    bibitems: dict[str, BibItem] = field(default_factory=dict)
    # bibitems keeps first definition per key; duplicate defs are noted separately
    duplicate_bibitem_lines: dict[str, list[tuple[str, int]]] = field(default_factory=dict)
    cites: list[CiteUse] = field(default_factory=list)
    skipped_inputs: list[str] = field(default_factory=list)


def resolve_document(top_path: str, verbose_skips: list[str]) -> Document:
    doc = Document(top_file=rel(top_path))
    visited: set[str] = set()

    # (abs_path, depth) queue for \input expansion, DFS matching source order
    # closely enough for reporting purposes.
    def walk(path: str, depth: int) -> None:
        abspath = os.path.normpath(path)
        if abspath in visited:
            return
        if depth > 15:
            doc.skipped_inputs.append(f"{rel(path)} (max include depth exceeded)")
            return
        if not os.path.isfile(abspath):
            doc.skipped_inputs.append(f"{rel(path)} (not found)")
            return
        visited.add(abspath)

        with open(abspath, encoding="utf-8", errors="replace") as fh:
            raw_lines = fh.readlines()

        file_dir = os.path.dirname(abspath)
        file_relpath = rel(abspath)

        # First pass: strip comments per line, and stitch a bibitem's body
        # across lines until the next \bibitem / \end{thebibliography}.
        current_key: str | None = None
        current_start_line = 0
        current_buf: list[str] = []

        def flush_current() -> None:
            nonlocal current_key, current_buf
            if current_key is None:
                return
            text = " ".join(current_buf)
            if current_key in doc.bibitems:
                doc.duplicate_bibitem_lines.setdefault(current_key, []).append(
                    (file_relpath, current_start_line)
                )
            else:
                doc.bibitems[current_key] = BibItem(
                    key=current_key, file=file_relpath, line=current_start_line, raw_text=text
                )
            current_key = None
            current_buf = []

        for lineno, raw_line in enumerate(raw_lines, start=1):
            code = strip_comments(raw_line.rstrip("\n"))

            # \cite{...} — may appear anywhere, independent of bibitem state.
            for m in CITE_RE.finditer(code):
                for key in split_keys(m.group(1)):
                    doc.cites.append(CiteUse(key=key, file=file_relpath, line=lineno))

            # \bibitem{...} — starts a new entry; a line may contain more than
            # one only in pathological input, so handle iteratively.
            bib_matches = list(BIBITEM_RE.finditer(code))
            if bib_matches:
                # Text before the first bibitem on this line still belongs to
                # the entry in progress (e.g. \end{thebibliography} closing a
                # multi-bibitem inline block is not expected here, but be safe).
                pre = code[: bib_matches[0].start()]
                if current_key is not None and pre.strip():
                    current_buf.append(pre)
                for idx, m in enumerate(bib_matches):
                    flush_current()
                    current_key = m.group(1)
                    current_start_line = lineno
                    seg_end = (
                        bib_matches[idx + 1].start() if idx + 1 < len(bib_matches) else len(code)
                    )
                    current_buf.append(code[m.end():seg_end])
            elif current_key is not None:
                if "\\end{thebibliography}" in code:
                    flush_current()
                else:
                    current_buf.append(code)

            # \input{X} / \include{X} — resolve relative to *this* file's dir.
            for m in INPUT_RE.finditer(code):
                target = m.group(1).strip()
                if not target.lower().endswith(".tex"):
                    target += ".tex"
                walk(os.path.join(file_dir, target), depth + 1)

        flush_current()

    walk(top_path, 0)
    verbose_skips.extend(f"{doc.top_file}: skipped \\input target {s}" for s in doc.skipped_inputs)
    return doc


# ---------------------------------------------------------------------------
# Check 4 — confidence register cross-check
# ---------------------------------------------------------------------------

CONF_ORDER = ["verified", "probable", "uncertain", "unresolved"]


def normalize_confidence(raw: str) -> str | None:
    low = raw.lower()
    # Order matters: some cells read "verified — do not cite" style, but the
    # register only ever uses these four canonical labels; take the first one
    # that appears in the cell text.
    for label in CONF_ORDER:
        if label in low:
            return label
    return None


def clean_md_cell(cell: str) -> str:
    cell = cell.replace("**", "").replace("`", "")
    return cell.strip()


@dataclass
class Candidate:
    citation_text: str
    confidence: str
    source_file: str
    words: set[str]
    years: set[str]
    surname_words: set[str]


def word_tokens(text: str) -> set[str]:
    words = re.findall(r"[A-Za-z]{4,}", text.lower())
    return {w for w in words if w not in STOPWORDS}


def parse_bibliography_md(path: str) -> list[Candidate]:
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8") as fh:
        text = fh.read()

    lines = text.splitlines()
    candidates: list[Candidate] = []
    in_part1 = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## Part 1"):
            in_part1 = True
            continue
        if stripped.startswith("## Part 2"):
            in_part1 = False
            continue
        if not in_part1:
            continue
        if not stripped.startswith("|"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) < 2:
            continue
        if re.fullmatch(r":?-{2,}:?", cells[0]):
            continue  # header separator row
        if cells[0].lower() == "citation":
            continue  # header row
        citation_cell = clean_md_cell(cells[0])
        confidence_cell = clean_md_cell(cells[1]) if len(cells) > 1 else ""
        confidence = normalize_confidence(confidence_cell)
        if confidence is None or not citation_cell:
            continue
        years = set(YEAR_RE.findall(citation_cell))
        words = word_tokens(citation_cell)
        # Surname-ish words: capitalized tokens appearing before the first
        # quote/year in the raw (pre-lowercasing) citation text — a rough
        # proxy for author names as opposed to title/venue words.
        head = citation_cell
        for sep in ('"', "\u201c", ".\u201d", "\u2019\u2019"):
            if sep in head:
                head = head.split(sep, 1)[0]
                break
        surnames = {w.lower() for w in re.findall(r"\b[A-Z][a-zA-Z\u00C0-\u017F]{2,}\b", head)}
        candidates.append(
            Candidate(
                citation_text=citation_cell,
                confidence=confidence,
                source_file=rel(path),
                words=words,
                years=years,
                surname_words=surnames,
            )
        )
    return candidates


OVERRIDE_WINDOW = 400
STRONG_VERIFIED_MARKERS = [
    "verified", "clear", "resolved:", "add — verified", "confirmed",
]
STRONG_NEGATIVE_MARKERS = [
    "do not cite", "unresolved", "excluded", "subsumed", "contradicted",
    "not obtained",
]


def apply_findings_overrides(candidates: list[Candidate]) -> list[tuple[Candidate, str]]:
    """Return (candidate, note) pairs where a findings.md file's text near the
    candidate's surname suggests a verdict — used only to explain a match,
    never silently mutated into ground truth. findings.md wins over
    BIBLIOGRAPHY.md per the task's stated rule, so a 'verified' signal here
    downgrades the candidate out of the report."""
    findings_texts: dict[str, str] = {}
    for fpath in sorted(glob.glob(os.path.join(REPO_ROOT, FINDINGS_GLOB))):
        if is_excluded(fpath):
            continue
        with open(fpath, encoding="utf-8", errors="replace") as fh:
            findings_texts[rel(fpath)] = fh.read()

    resolved: list[tuple[Candidate, str]] = []
    for cand in candidates:
        if not cand.surname_words:
            resolved.append((cand, ""))
            continue
        override_note = ""
        for fpath, text in findings_texts.items():
            low = text.lower()
            for surname in cand.surname_words:
                idx = low.find(surname)
                if idx == -1:
                    continue
                window = low[max(0, idx - OVERRIDE_WINDOW): idx + OVERRIDE_WINDOW]
                if any(m in window for m in STRONG_VERIFIED_MARKERS) and not any(
                    m in window for m in STRONG_NEGATIVE_MARKERS
                ):
                    override_note = f"findings.md ({fpath}) reads as verified near '{surname}'"
                    cand = Candidate(
                        cand.citation_text, "verified", fpath, cand.words, cand.years,
                        cand.surname_words,
                    )
                    break
            if override_note:
                break
        resolved.append((cand, override_note))
    return resolved


def find_confidence_mismatches(
    documents: list[Document], candidates_resolved: list[tuple[Candidate, str]]
) -> list[str]:
    findings: list[str] = []
    for doc in documents:
        for key, bib in sorted(doc.bibitems.items()):
            cited_here = any(c.key == key for c in doc.cites)
            if not cited_here:
                continue  # only "live" bibitems are in scope for check 4
            bib_words = word_tokens(bib.raw_text)
            bib_years = set(YEAR_RE.findall(bib.raw_text))
            if not bib_years:
                continue
            for cand, note in candidates_resolved:
                if cand.confidence == "verified":
                    continue
                if not (bib_years & cand.years):
                    continue
                shared = bib_words & cand.words
                if len(shared) < 2:
                    continue
                findings.append(
                    f"{bib.file}:{bib.line}: \\bibitem{{{key}}} (cited in {doc.top_file}) "
                    f"looks like a {cand.confidence} candidate from {cand.source_file}: "
                    f"\"{cand.citation_text}\" "
                    f"[shared words: {', '.join(sorted(shared))}; shared year: "
                    f"{', '.join(sorted(bib_years & cand.years))}]"
                    + (f" — {note}" if note else "")
                )
    return findings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true", help="print full bibitem/cite inventory")
    args = parser.parse_args()

    corpus_files = discover_corpus_files()
    if not corpus_files:
        print("No corpus files found — check CORPUS_PATTERNS.", file=sys.stderr)
        return 1

    verbose_skips: list[str] = []
    documents = [resolve_document(f, verbose_skips) for f in corpus_files]

    orphaned: list[str] = []
    dangling: list[str] = []
    duplicates: list[str] = []

    for doc in documents:
        cited_keys = {c.key for c in doc.cites}
        for key, bib in sorted(doc.bibitems.items(), key=lambda kv: (kv[1].file, kv[1].line)):
            if key not in cited_keys:
                orphaned.append(
                    f"{bib.file}:{bib.line}: \\bibitem{{{key}}} is defined but never "
                    f"\\cite'd anywhere in {doc.top_file}"
                )
        for cite in sorted(doc.cites, key=lambda c: (c.file, c.line)):
            if cite.key not in doc.bibitems:
                dangling.append(
                    f"{cite.file}:{cite.line}: \\cite{{{cite.key}}} has no matching "
                    f"\\bibitem in {doc.top_file}'s bibliography"
                )
        for key, dupes in sorted(doc.duplicate_bibitem_lines.items()):
            for dfile, dline in dupes:
                duplicates.append(
                    f"{dfile}:{dline}: \\bibitem{{{key}}} redefines a key already "
                    f"defined at {doc.bibitems[key].file}:{doc.bibitems[key].line} "
                    f"in {doc.top_file}"
                )

    bibliography_path = os.path.join(REPO_ROOT, BIBLIOGRAPHY_MD)
    candidates = parse_bibliography_md(bibliography_path)
    candidates_resolved = apply_findings_overrides(candidates)
    mismatches = find_confidence_mismatches(documents, candidates_resolved)

    print(f"Scanned {len(corpus_files)} top-level .tex file(s) across 3 corpora:")
    for pattern in CORPUS_PATTERNS:
        matched = [rel(f) for f in corpus_files if _matches_pattern(f, pattern)]
        print(f"  {pattern}  ({len(matched)} file(s))")
    print()

    if args.verbose:
        print("=" * 78)
        print("INVENTORY (--verbose)")
        print("=" * 78)
        for doc in documents:
            print(f"\n{doc.top_file}")
            print(f"  bibitems: {len(doc.bibitems)}   cites: {len(doc.cites)}")
            for key, bib in sorted(doc.bibitems.items(), key=lambda kv: kv[1].line):
                print(f"    bibitem {key:<20} {bib.file}:{bib.line}")
            for cite in sorted(doc.cites, key=lambda c: c.line):
                print(f"    cite    {cite.key:<20} {cite.file}:{cite.line}")
            if doc.skipped_inputs:
                for s in doc.skipped_inputs:
                    print(f"    (skipped \\input: {s})")
        print()

    print("=" * 78)
    print(f"CHECK 2 — Orphaned \\bibitem (defined, never \\cite'd): {len(orphaned)} found")
    print("=" * 78)
    for line in orphaned:
        print(f"  {line}")
    print()

    print("=" * 78)
    print(f"CHECK 3 — Dangling \\cite (no matching \\bibitem): {len(dangling)} found")
    print("=" * 78)
    for line in dangling:
        print(f"  {line}")
    print()

    if duplicates:
        print("=" * 78)
        print(f"EXTRA — Duplicate \\bibitem keys within one document: {len(duplicates)} found")
        print("=" * 78)
        for line in duplicates:
            print(f"  {line}")
        print()

    print("=" * 78)
    print(
        f"CHECK 4 — Confidence-register mismatches (advisory, non-blocking): "
        f"{len(mismatches)} found"
    )
    print("=" * 78)
    if not mismatches:
        print("  (none — every fuzzy-matched, actually-cited \\bibitem resolves to `verified`)")
    for line in mismatches:
        print(f"  {line}")
    print()

    if args.verbose and verbose_skips:
        print("=" * 78)
        print("SKIPPED \\input TARGETS (--verbose)")
        print("=" * 78)
        for s in verbose_skips:
            print(f"  {s}")
        print()

    print("=" * 78)
    print(
        f"SUMMARY: {len(orphaned)} orphaned bibitem(s), {len(dangling)} dangling cite(s), "
        f"{len(duplicates)} duplicate bibitem(s), {len(mismatches)} advisory confidence "
        f"mismatch(es)"
    )
    print("=" * 78)

    return 1 if (orphaned or dangling) else 0


def _matches_pattern(path: str, pattern: str) -> bool:
    return os.path.dirname(path) == os.path.dirname(os.path.join(REPO_ROOT, pattern))


if __name__ == "__main__":
    sys.exit(main())
