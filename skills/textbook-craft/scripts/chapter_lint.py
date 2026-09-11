#!/usr/bin/env python3
r"""chapter_lint.py -- report a LaTeX chapter's structure against the
textbook-craft template's floors.

A DO-CONFIRM checklist (Gawande, references/canon.md), not a READ-DO
tutorial: it reports what is present and what the template requires, so an
author who already knows how to write a chapter can see what this one is
missing under deadline. It does not rewrite anything and does not judge
prose quality -- only mechanically checkable structure:

  - sections and subsections (title, line range)
  - worked examples per section (pdexample envs, plus the legacy `example`
    amsthm environment if the chapter defines one), against the floor of
    >=1 per top-level section (Axler / SICP / Pierce; canon.md)
  - exercise clusters (old-style `\exercises{...}` macro calls and new-style
    `\pdexercisesfor`/`\pdexercise`), and whether each sits inside a
    chapter-end "Exercises" section or interrupts the body mid-argument
    (Wave 12 finding F1, READING-FLOW-AUDIT.md)
  - claim-like environments (theorem/lemma/definition/property/corollary,
    and the new-style `pdclaim{KIND}{...}`) and whether each carries a
    nearby epistemic-kind tag from the honesty ledger (Theorem / Design
    invariant / Model-checked property / Empirical hypothesis, or this
    project's own maturity macros: \\Built \\BuiltWeak \\Designed \\Vision
    \\NotGuar \\Closed \\Partial \\Open \\pdassurance{...})
  - legacy tinted-box macro definitions (a `\\newcommand` whose body draws a
    `fill=` node) -- the page-grammar anti-pattern pd-pedagogy.tex replaced
    with typography-and-margin ("no page paints a background")
  - interludes (a section/subsection titled "Interlude...") -- at most one
    is the template's rule, not "the more the richer"
  - chapter-close apparatus: a Review-of-Key-Ideas-equivalent, a
    History-and-references-equivalent, and a boundary/handoff section,
    each detected by title keyword since chapters predate a fixed heading
    vocabulary

Usage:
    python3 chapter_lint.py CHAPTER.tex [--json] [--md] [--strict]
    python3 chapter_lint.py CH1.tex CH2.tex ... [--json] [--md] [--strict]
    python3 chapter_lint.py CHAPTER.tex --table   # force the one-table report
    python3 chapter_lint.py --strict              # no files given: lint every
                                                    # chapter in whitepaper/textbook.json

Given more than one chapter (or --table), the report becomes a single
consolidated table -- one row per (chapter, floor) -- instead of N separate
per-chapter reports, so a CI run over every chapter reads on one screen. Given
NO chapter at all, the chapter list is read from the `source` field of every
entry in whitepaper/textbook.json (same convention and same default-list
function shape as skills/tufte-evidence-design/scripts/margin_lint.py's
default_chapter_sources) -- so a CI step never hard-codes the Book's eight
chapter paths and picks up a ninth chapter for free the day textbook.json
gains one.

Some floors are advisory: reported (status WARN when unmet) but never the
reason --strict exits 1. These are corpus-wide template debt that predates the
gate: worked examples per section, chapter-end exercise placement, claim-kind
labels, the composite opener/claim-label rule, and complete close apparatus.
The remaining floors are blocking.

Exit code: 0 always, unless --strict is given and at least one BLOCKING
floor is violated (then 1), or a chapter file cannot be found/read/parsed
(then 2). stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# skills/textbook-craft/scripts/chapter_lint.py -> scripts -> textbook-craft
# -> skills -> repo root (same depth, same convention, as
# skills/tufte-evidence-design/scripts/margin_lint.py's REPO_ROOT).
REPO_ROOT = Path(__file__).resolve().parents[3]

# ---------------------------------------------------------------------------
# Vocabulary, per whitepaper/figures/pd-pedagogy.tex and this project's own
# maturity-grading macros (see references/sources.md and references/canon.md
# for where each name comes from).
# ---------------------------------------------------------------------------

CLAIM_ENVS = ("theorem", "lemma", "definition", "property", "corollary", "proposition")
PDCLAIM_KINDS = ("Theorem", "Design invariant", "Model-checked property", "Empirical hypothesis")
# Epistemic-kind tags this project actually uses near a claim, beyond the
# pdclaim kind words themselves: research-maturity grades (seen in
# whitepaper/single-writer-kernel.tex) and the pdassurance vocabulary.
EPISTEMIC_TAG_RE = re.compile(
    r"\\(Built|BuiltWeak|Designed|Vision|NotGuar|Closed|Partial|Open|pdassurance)\b"
)
TINTED_BOX_MACROS = ("keyidea", "pitfall", "exercises", "scene", "xrefbox", "pullquote", "scene")
CHAPTER_CLOSE_KEYWORDS = {
    "review": re.compile(r"review of the key ideas|key ideas", re.I),
    "history_and_references": re.compile(r"history and references|related work|further reading", re.I),
    "boundary_or_handoff": re.compile(
        r"limitations?|open problems?|boundary|threat model|what this chapter|does not solve|assumes and provides",
        re.I,
    ),
}
EXERCISES_SECTION_TITLE_RE = re.compile(r"exercises?\b", re.I)
INTERLUDE_TITLE_RE = re.compile(r"\binterlude\b", re.I)


# Same idiom as scripts/harbor-research/check_plate_provenance.py's
# _TEX_COMMENT_RE: an unescaped `%` starts a comment running to end of line;
# `\%` is a literal percent, not a comment. `.` does not match `\n`, so the
# substitution removes only the commented text and leaves every newline in
# place -- line numbers computed against the stripped text still point at
# the real source line, with no separate line-number map to maintain.
_TEX_COMMENT_RE = re.compile(r"(?<!\\)%.*$", re.MULTILINE)


def strip_comments(text: str) -> str:
    """Drop LaTeX line comments (an unescaped % to end of line) before any
    regex pass, so a commented-out macro call, a stray brace in a comment,
    or a tag word mentioned in prose after a % is never mistaken for a live
    one. Preserves every newline, so line numbers stay correct for free."""
    return _TEX_COMMENT_RE.sub("", text)


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def balanced_brace_arg(text: str, start: int):
    """Given `start` pointing at (or before) the first '{' of a macro
    argument, return (arg_content, end_index_after_closing_brace).
    Returns (None, start) if no '{' is found before other non-space text."""
    i = start
    n = len(text)
    while i < n and text[i] in " \t\n":
        i += 1
    if i >= n or text[i] != "{":
        return None, start
    depth = 0
    j = i
    while j < n:
        c = text[j]
        if c == "\\" and j + 1 < n:
            j += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1 : j], j + 1
        j += 1
    return text[i + 1 :], n  # unbalanced; return what we have


def balanced_env_body(text: str, env: str, body_start: int):
    """The environment equivalent of balanced_brace_arg: given `body_start`
    pointing right after an already-matched `\\begin{env}` (its own optional
    bracket argument, if any, already consumed), return (body, end_index)
    where `body` is everything up to the matching `\\end{env}` and
    `end_index` is the offset just past it. Depth-counts `\\begin{env}` /
    `\\end{env}` pairs of the SAME name, so a claim that nests another
    instance of itself is still matched correctly. Returns
    (text[body_start:], len(text)) if no matching \\end{env} is found."""
    pat = re.compile(r"\\begin\{" + re.escape(env) + r"\}|\\end\{" + re.escape(env) + r"\}")
    depth = 1
    for m in pat.finditer(text, body_start):
        if m.group(0).startswith("\\begin"):
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                return text[body_start:m.start()], m.end()
    return text[body_start:], len(text)


@dataclass
class Section:
    kind: str  # "section" or "subsection"
    title: str
    start: int  # char offset
    line: int
    end: int = -1  # char offset of next same-or-higher-level heading, or EOF
    title_end: int = -1  # char offset just past the heading's own closing brace
    parent_section_idx: int = -1  # index into sections list of enclosing \section, for a subsection


@dataclass
class Claim:
    env: str
    title: str
    line: int
    tagged: bool
    tag_found: str = ""


@dataclass
class ExerciseCluster:
    macro: str  # "\\exercises" or "\\pdexercisesfor" or "\\pdexercise"
    line: int
    in_exercises_section: bool
    enclosing_section_title: str


@dataclass
class ChapterReport:
    path: str
    total_lines: int
    sections: list = field(default_factory=list)
    claims: list = field(default_factory=list)
    examples_per_section: dict = field(default_factory=dict)  # section title -> count
    session_count: int = 0
    exercise_clusters: list = field(default_factory=list)
    interludes: list = field(default_factory=list)
    tinted_box_macros: list = field(default_factory=list)
    chapter_close: dict = field(default_factory=dict)  # keyword -> bool
    imports_pd_pedagogy: bool = False
    floors: dict = field(default_factory=dict)  # floor name -> {"ok": bool, "detail": str}


def parse_sections(text: str):
    sections = []
    pat = re.compile(r"\\(section|subsection)\*?\{", re.M)
    for m in pat.finditer(text):
        kind = m.group(1)
        title, title_end = balanced_brace_arg(text, m.end() - 1)
        title = re.sub(r"\\label\{[^}]*\}", "", title or "").strip()
        sections.append(Section(kind=kind, title=title, start=m.start(), line=line_of(text, m.start()), title_end=title_end))
    # A \section's span runs to the NEXT \section (its own subsections nest
    # inside it and must not truncate it); a \subsection's span runs to the
    # next heading of either kind. Record each subsection's enclosing
    # \section index for per-section rollups.
    sections.sort(key=lambda s: s.start)
    last_section_idx = -1
    for i, s in enumerate(sections):
        if s.kind == "section":
            last_section_idx = i
            s.parent_section_idx = i
            nxt = next((sections[j].start for j in range(i + 1, len(sections)) if sections[j].kind == "section"), len(text))
            s.end = nxt
        else:
            s.parent_section_idx = last_section_idx
            s.end = sections[i + 1].start if i + 1 < len(sections) else len(text)
    return sections


def enclosing_top_section_obj(sections, pos: int):
    """The Section object for the nearest top-level \\section enclosing
    character offset pos, or None if pos precedes the first section."""
    best = None
    for s in sections:
        if s.kind == "section" and s.start <= pos < s.end:
            best = s
    return best


def enclosing_top_section(sections, pos: int) -> str:
    """The nearest top-level \\section title enclosing character offset pos,
    or "(preamble/front matter)" if pos precedes the first section."""
    s = enclosing_top_section_obj(sections, pos)
    return s.title if s else "(preamble/front matter)"


def find_claims(text: str, sections):
    claims = []
    for env in CLAIM_ENVS:
        for m in re.finditer(r"\\begin\{" + env + r"\}(\[[^\]]*\])?", text):
            title = (m.group(1) or "")[1:-1] if m.group(1) else ""
            # The tag must sit inside the claim's OWN body -- a fixed ±char
            # window around \begin can pick up a tag belonging to the
            # PRECEDING paragraph or the FOLLOWING claim instead of this
            # one, especially for a short claim sandwiched between two
            # tagged ones. balanced_env_body finds the real, brace-and-env
            # -balanced extent of this claim and nothing else.
            body, _ = balanced_env_body(text, env, m.end())
            tag = EPISTEMIC_TAG_RE.search(body)
            claims.append(
                Claim(
                    env=env,
                    title=title,
                    line=line_of(text, m.start()),
                    tagged=bool(tag),
                    tag_found=tag.group(1) if tag else "",
                )
            )
    # New-style pdclaim{KIND}{Title}
    for m in re.finditer(r"\\begin\{pdclaim\}\{", text):
        kind, after_kind = balanced_brace_arg(text, m.end() - 1)
        title, _ = balanced_brace_arg(text, after_kind)
        claims.append(
            Claim(env="pdclaim:" + (kind or "?"), title=(title or "").strip(), line=line_of(text, m.start()), tagged=True, tag_found=kind or "")
        )
    claims.sort(key=lambda c: c.line)
    return claims


def find_examples(text: str, sections):
    counts: dict[str, int] = {}
    sessions = 0
    for m in re.finditer(r"\\begin\{pdexample\}", text):
        title = enclosing_top_section(sections, m.start())
        counts[title] = counts.get(title, 0) + 1
    for m in re.finditer(r"\\begin\{example\}", text):
        title = enclosing_top_section(sections, m.start())
        counts[title] = counts.get(title, 0) + 1
    sessions = len(list(re.finditer(r"\\begin\{pdsession\}", text)))
    return counts, sessions


def find_final_exercises_section(sections):
    """The chapter's own closing-sequence Exercises section (chapter-
    template.md's order: Review -> Exercises -> History and references ->
    handoff -- Exercises is NOT literally the document's last \\section,
    since History/references and the handoff follow it). "Final" means the
    LAST top-level section whose title matches Exercises, not the last
    \\section overall -- guards against an early, unrelated section that
    happens to share the word without accidentally requiring Exercises to
    be the literal end of the document. Returns None if no section's title
    matches at all."""
    top_sections = [s for s in sections if s.kind == "section"]
    matches = [s for s in top_sections if EXERCISES_SECTION_TITLE_RE.search(s.title)]
    return matches[-1] if matches else None


def find_exercise_clusters(text: str, sections):
    # The template's rule (chapter-template.md §Chapter close) is not merely
    # "inside *a* section titled Exercises" but that specific closing-
    # sequence section -- see find_final_exercises_section. Comparing
    # Section objects (not title strings) avoids a false match against an
    # earlier, differently-purposed section that happens to share the word
    # "exercises" in its title.
    exercises_section = find_final_exercises_section(sections)

    def in_final_exercises(pos: int) -> bool:
        return bool(exercises_section and enclosing_top_section_obj(sections, pos) is exercises_section)

    clusters = []
    # Old-style: \exercises{...} macro call with a balanced-brace body.
    for m in re.finditer(r"\\exercises\{", text):
        # Guard against matching the macro's own \newcommand{\exercises} definition.
        prefix = text[max(0, m.start() - 20) : m.start()]
        if "newcommand" in prefix:
            continue
        title = enclosing_top_section(sections, m.start())
        clusters.append(
            ExerciseCluster(
                macro="\\exercises",
                line=line_of(text, m.start()),
                in_exercises_section=in_final_exercises(m.start()),
                enclosing_section_title=title,
            )
        )
    # New-style chapter-end grouping marker and per-item exercise environment.
    for macro in ("pdexercisesfor", "pdexercise"):
        for m in re.finditer(r"\\begin\{" + macro + r"\}|\\" + macro + r"\{", text):
            title = enclosing_top_section(sections, m.start())
            clusters.append(
                ExerciseCluster(
                    macro="\\" + macro,
                    line=line_of(text, m.start()),
                    in_exercises_section=in_final_exercises(m.start()),
                    enclosing_section_title=title,
                )
            )
    clusters.sort(key=lambda c: c.line)
    return clusters


def find_interludes(sections):
    return [s.title for s in sections if INTERLUDE_TITLE_RE.search(s.title)]


def find_tinted_box_macros(text: str):
    found = []
    for name in TINTED_BOX_MACROS:
        for m in re.finditer(r"\\newcommand\{\\" + name + r"\}", text):
            body, end = balanced_brace_arg(text, text.find("{", m.end()))
            # balanced_brace_arg above expects to start at the arg's own
            # opening brace; \newcommand{\name}[n]{BODY} has an optional
            # [n] between -- walk past it if present.
            after = m.end()
            opt = re.match(r"\s*\[[^\]]*\]", text[after:])
            if opt:
                after += opt.end()
            body, _ = balanced_brace_arg(text, after)
            if body and "fill=" in body:
                found.append({"macro": "\\" + name, "line": line_of(text, m.start())})
    return found


PD_PEDAGOGY_INPUT_RE = re.compile(r"\\input\{[^}]*pd-pedagogy\}")


def imports_pd_pedagogy(text: str) -> bool:
    """Whether the chapter source itself claims to \\input the pedagogy
    twin. This is no longer used to decide whether a legacy tinted-box
    macro is dead (see find_pd_pedagogy_file / neutralized_macro_names --
    that is now settled by parsing pd-pedagogy.tex itself); it backs its
    own floor instead: a chapter can only get the shared page grammar
    (claim boxes, boundaries, worked examples, exercises) by actually
    \\input{ting} this file, whatever it says about its own preamble."""
    return bool(PD_PEDAGOGY_INPUT_RE.search(text))


def find_pd_pedagogy_file(chapter_path: Path):
    """Locate whitepaper/figures/pd-pedagogy.tex by walking upward from the
    chapter file's own location, the way \\input{figures/pd-pedagogy}
    resolves relative to a repo root -- rather than trusting a single
    hard-coded absolute path (the fragility a reviewer flagged). Works from
    any chapter's real location in the repo, or a test fixture tree laid
    out the same way. Returns None if no such file is found above `chapter_path`."""
    cur = chapter_path.resolve()
    if cur.is_file():
        cur = cur.parent
    for candidate in (cur, *cur.parents):
        p = candidate / "whitepaper" / "figures" / "pd-pedagogy.tex"
        if p.is_file():
            return p
    return None


_ATBEGINDOCUMENT_RE = re.compile(r"\\AtBeginDocument\{")
_LONG_DEF_RE = re.compile(r"\\long\\def\\([A-Za-z@]+)")


def neutralized_macro_names(pd_pedagogy_path) -> set:
    """The macro names pd-pedagogy.tex's own \\AtBeginDocument block
    re-\\long\\def's (today: keyidea, pitfall, scene, xrefbox, pullquote).
    A chapter-preamble \\newcommand under one of these names -- however it
    draws itself, typically a tikz fill= box, pre-reform -- is neutralized
    at \\begin{document} time no matter what the chapter's own preamble
    says; a \\newcommand under any OTHER name (e.g. the old \\exercises{...}
    tinted box, which pd-pedagogy.tex does NOT re-define) is not. Parsed
    from the file itself, not a hard-coded name list, so a future edit to
    pd-pedagogy.tex's AtBeginDocument block is picked up for free. Returns
    an empty set if the file can't be found or parsed -- callers then treat
    every fill-drawing macro as live (the conservative failure mode)."""
    if pd_pedagogy_path is None or not pd_pedagogy_path.is_file():
        return set()
    text = strip_comments(pd_pedagogy_path.read_text(encoding="utf-8", errors="replace"))
    # Every \\AtBeginDocument block, not the first one. pd-pedagogy.tex has
    # more than one: the margin apparatus opens a block of its own to hook
    # \\section for the pending-pointer check, and it happens to come first,
    # so searching for a single block returned that one, found no \\long\\def
    # in it and reported that nothing is neutralized -- which reads as "every
    # fill-drawing macro is live" and is wrong in the direction that matters.
    names = set()
    for m in _ATBEGINDOCUMENT_RE.finditer(text):
        body, _ = balanced_brace_arg(text, m.end() - 1)
        if body:
            names |= set(_LONG_DEF_RE.findall(body))
    return names


_TABLE_START_RE = re.compile(r"\\begin\{(table\*?|tabular\*?|longtable)\}")
_CLAIM_START_RE = re.compile(r"\\begin\{(" + "|".join(CLAIM_ENVS) + r"|pdclaim)\}")
_EPIGRAPH_MACRO_RE = re.compile(r"\\(epigraph|pdchapterepigraph)\b")


def find_opener_kind(text: str, top_sections):
    """What immediately follows the chapter's first top-level \\section
    heading (its own \\label{...}, if any, skipped): 'epigraph' (an
    epigraph macro), 'table' or 'claim' (jumps cold into one), 'prose'
    (ordinary text -- the template's failure-scene paragraph, in effect),
    or None if the chapter has no top-level section at all. Mirrors the
    chapter template's page-1 order (chapter-template.md): title, epigraph,
    scene, question, and ONLY THEN the boxed claim -- a section that starts
    with a table or a claim environment has skipped straight past the
    opener the template requires."""
    if not top_sections:
        return None
    i = top_sections[0].title_end
    n = len(text)
    while True:
        while i < n and text[i] in " \t\n":
            i += 1
        lbl = re.match(r"\\label\{", text[i:])
        if lbl:
            _, end = balanced_brace_arg(text, i + lbl.end() - 1)
            i = end
            continue
        break
    upcoming = text[i : i + 60]
    if _TABLE_START_RE.match(upcoming):
        return "table"
    if _CLAIM_START_RE.match(upcoming):
        return "claim"
    if _EPIGRAPH_MACRO_RE.match(upcoming):
        return "epigraph"
    return "prose"


def check_chapter_close(text: str, sections):
    result = {}
    for key, pat in CHAPTER_CLOSE_KEYWORDS.items():
        hit = None
        for s in sections:
            if pat.search(s.title):
                hit = s.title
                break
        result[key] = {"present": hit is not None, "matched_title": hit}
    return result


def build_report(path: Path) -> ChapterReport:
    raw = path.read_text(encoding="utf-8", errors="replace")
    text = strip_comments(raw)
    sections = parse_sections(text)
    top_sections = [s for s in sections if s.kind == "section"]

    claims = find_claims(text, sections)
    examples_per_section, session_count = find_examples(text, sections)
    exercise_clusters = find_exercise_clusters(text, sections)
    interludes = find_interludes(sections)
    tinted = find_tinted_box_macros(text)
    chapter_close = check_chapter_close(text, sections)

    report = ChapterReport(
        path=str(path),
        total_lines=raw.count("\n") + 1,
        sections=[{"kind": s.kind, "title": s.title, "line": s.line} for s in sections],
        claims=[c.__dict__ for c in claims],
        examples_per_section=examples_per_section,
        session_count=session_count,
        exercise_clusters=[c.__dict__ for c in exercise_clusters],
        interludes=interludes,
        tinted_box_macros=tinted,
        chapter_close=chapter_close,
        imports_pd_pedagogy=imports_pd_pedagogy(text),
    )

    # ---- Floors -----------------------------------------------------
    sections_with_zero_examples = [
        s.title for s in top_sections if examples_per_section.get(s.title, 0) == 0
    ]
    report.floors["worked_example_per_section"] = {
        "ok": not sections_with_zero_examples,
        "advisory": True,
        "detail": (
            f"{len(sections_with_zero_examples)}/{len(top_sections)} top-level sections have zero "
            "worked examples (pdexample/example): "
            + "; ".join(sections_with_zero_examples[:8])
            + (" ..." if len(sections_with_zero_examples) > 8 else "")
        )
        if sections_with_zero_examples
        else f"all {len(top_sections)} top-level sections have >=1 worked example",
    }

    # Advisory (item 4): the template's rule is the chapter's closing-
    # sequence \section titled Exercises specifically (chapter-template.md:
    # Review -> Exercises -> History and references -> handoff -- Exercises
    # is not literally the document's last \section), not merely some
    # section along the way that happens to share the word -- see
    # find_final_exercises_section / find_exercise_clusters. Advisory
    # because none of the Book's chapters have actually been relocated to
    # match this yet (Wave 12 finding F1 named the defect; the relocation
    # itself is still open per-chapter work), so this must report without
    # gating --strict.
    exercises_section = find_final_exercises_section(sections)
    mid_body = [c for c in exercise_clusters if not c.in_exercises_section]
    report.floors["exercises_at_chapter_end"] = {
        "ok": not mid_body,
        "advisory": True,
        "detail": (
            f"{len(mid_body)}/{len(exercise_clusters)} exercise clusters sit outside the chapter's "
            "closing \\section titled 'Exercises' (Wave 12 finding F1: this is the exact defect the "
            "chapter-end apparatus was built to fix). "
            + ("No section titled 'Exercises' was found at all. " if not exercises_section else "")
            + "Lines: " + ", ".join(str(c.line) for c in mid_body[:12])
            + (" ..." if len(mid_body) > 12 else "")
        )
        if mid_body
        else (
            f"all {len(exercise_clusters)} exercise clusters sit inside the chapter's closing 'Exercises' section"
            if exercise_clusters
            else "no exercise clusters found"
        ),
    }

    untagged = [c for c in claims if not c.tagged]
    report.floors["claims_carry_epistemic_kind"] = {
        "ok": not untagged,
        "advisory": True,
        "detail": (
            f"{len(untagged)}/{len(claims)} claim-like environments (theorem/lemma/definition/"
            "property/corollary) carry no epistemic-kind tag INSIDE THEIR OWN BODY (pdclaim kind, "
            "or a \\Built/\\Designed/\\pdassurance-style maturity marker) -- the honesty ledger "
            "requires every claim state its own kind where it is made. Lines: "
            + ", ".join(f"{c.line} ({c.env})" for c in untagged[:12])
            + (" ..." if len(untagged) > 12 else "")
        )
        if untagged
        else (f"all {len(claims)} claims carry an epistemic-kind tag" if claims else "no claim-like environments found"),
    }

    # Item 3: dead-or-live is settled by parsing whitepaper/figures/pd-pedagogy.tex
    # itself (which macro names its \AtBeginDocument block actually
    # re-\long\def's), not by whether THIS chapter happens to \input it. A
    # fill=-drawing \newcommand whose name IS in that set is dead no matter
    # what; one that is NOT (e.g. \exercises, which pd-pedagogy.tex never
    # redefines) fails unconditionally, import or no import.
    pd_pedagogy_path = find_pd_pedagogy_file(path)
    neutralized = neutralized_macro_names(pd_pedagogy_path)
    for t in tinted:
        t["neutralized"] = t["macro"].lstrip("\\") in neutralized
    dead = [t for t in tinted if t["neutralized"]]
    live = [t for t in tinted if not t["neutralized"]]
    if not tinted:
        tinted_detail = "no tinted-box macro definitions found"
    elif not live:
        tinted_detail = (
            f"{len(tinted)} legacy tinted-box macro(s) defined with a fill= node, but "
            "whitepaper/figures/pd-pedagogy.tex's own \\AtBeginDocument block re-\\long\\def's "
            "every one of their names as a run-in or margin head with plain prose -- the "
            "preamble definitions are cosmetic leftovers, never live at render time: "
            + ", ".join(f"{t['macro']} (line {t['line']})" for t in dead)
        )
    else:
        tinted_detail = (
            f"{len(live)}/{len(tinted)} legacy tinted-box macro(s) draw a fill= node and are NOT "
            "re-defined by pd-pedagogy.tex's \\AtBeginDocument block, so they render as tinted "
            "rectangles regardless of whether this chapter \\input{s} the file (page grammar "
            "requires typography + margin, never a fill): "
            + ", ".join(f"{t['macro']} (line {t['line']})" for t in live)
            + (
                "; neutralized (dead) regardless: " + ", ".join(t["macro"] for t in dead)
                if dead
                else ""
            )
        )
        if pd_pedagogy_path is None:
            tinted_detail += " [whitepaper/figures/pd-pedagogy.tex could not be located above this chapter's path]"
    report.floors["no_tinted_box_macros"] = {"ok": not live, "detail": tinted_detail}

    # Item 5: getting the shared page grammar at all is a separate, harder
    # floor than whether any one legacy macro happens to be neutralized --
    # a chapter that never \input{s} pd-pedagogy gets no claim boxes, no
    # boundaries, no pdexample/pdexercise typesetting, whether or not its
    # preamble still defines any tinted-box macro.
    pd_pedagogy_imported = imports_pd_pedagogy(text)
    report.floors["imports_pd_pedagogy_twin"] = {
        "ok": pd_pedagogy_imported,
        "detail": (
            "chapter \\input{s} figures/pd-pedagogy -- the shared page grammar (claim boxes, "
            "boundaries, worked examples, exercises) is live"
            if pd_pedagogy_imported
            else "no \\input{...pd-pedagogy} found -- this chapter never gets the shared page "
            "grammar, independent of whether any legacy tinted-box macro happens to be neutralized"
        ),
    }

    # Advisory (item 6): the template requires the chapter to open with
    # prose or an epigraph (page 1's epigraph + failure-scene sequence),
    # never a cold table or claim, AND every claim-like environment to
    # carry a kind tag. Advisory because today's corpus does not comply
    # with the opener rule at all (no chapter yet calls an epigraph macro).
    opener_kind = find_opener_kind(text, top_sections)
    opener_ok = opener_kind in ("prose", "epigraph")
    report.floors["chapter_opener_and_claim_labeling"] = {
        "ok": opener_ok and not untagged,
        "advisory": True,
        "detail": (
            (
                "opener: " + (
                    "no top-level \\section found"
                    if opener_kind is None
                    else f"first \\section starts with a {opener_kind}" if opener_kind in ("table", "claim")
                    else f"first \\section opens with {opener_kind} -- OK"
                )
            )
            + f"; claim labeling: {len(untagged)}/{len(claims)} claim-like environments carry no kind tag"
            + (" (see claims_carry_epistemic_kind for detail)" if untagged else "")
        ),
    }

    report.floors["at_most_one_interlude"] = {
        "ok": len(interludes) <= 1,
        "detail": f"{len(interludes)} interlude(s): " + "; ".join(interludes) if interludes else "0 interludes",
    }

    missing_close = [k for k, v in chapter_close.items() if not v["present"]]
    report.floors["chapter_close_apparatus"] = {
        "ok": not missing_close,
        "advisory": True,
        "detail": (
            "missing: " + ", ".join(missing_close)
            if missing_close
            else "review/history/boundary sections all present (by title keyword match)"
        ),
    }

    return report


def floor_status(f: dict) -> str:
    """PASS, FAIL, or WARN -- WARN is an advisory floor that is not met
    (reported, but never the reason --strict exits 1; see is_blocking)."""
    if f["ok"]:
        return "PASS"
    return "WARN" if f.get("advisory") else "FAIL"


def is_blocking(f: dict) -> bool:
    """Whether an unmet floor should fail --strict (and a CI gate)."""
    return not f["ok"] and not f.get("advisory")


def render_text(report: ChapterReport) -> str:
    lines = []
    lines.append(f"chapter_lint: {report.path}  ({report.total_lines} lines, "
                 f"{sum(1 for s in report.sections if s['kind']=='section')} sections, "
                 f"{sum(1 for s in report.sections if s['kind']=='subsection')} subsections)")
    lines.append(f"  imports figures/pd-pedagogy: {report.imports_pd_pedagogy}")
    lines.append("")
    lines.append("Floors:")
    for name, f in report.floors.items():
        mark = floor_status(f)
        lines.append(f"  [{mark}] {name}")
        lines.append(f"         {f['detail']}")
    lines.append("")
    lines.append(f"Claims: {len(report.claims)} total, "
                 f"{sum(1 for c in report.claims if c['tagged'])} tagged, "
                 f"{sum(1 for c in report.claims if not c['tagged'])} untagged.")
    by_env: dict[str, int] = {}
    for c in report.claims:
        by_env[c["env"]] = by_env.get(c["env"], 0) + 1
    for env, n in sorted(by_env.items(), key=lambda kv: -kv[1]):
        lines.append(f"    {env}: {n}")
    lines.append("")
    lines.append(f"Worked examples: {sum(report.examples_per_section.values())} total "
                 f"(pdexample/example), {report.session_count} pdsession transcript(s).")
    for title, n in report.examples_per_section.items():
        lines.append(f"    {n}  {title}")
    lines.append("")
    lines.append(f"Exercise clusters: {len(report.exercise_clusters)} found.")
    for c in report.exercise_clusters:
        loc = "chapter-end" if c["in_exercises_section"] else "MID-BODY"
        lines.append(f"    line {c['line']:5d}  {c['macro']:<20} [{loc}]  in \"{c['enclosing_section_title']}\"")
    lines.append("")
    lines.append(f"Interludes: {len(report.interludes)}" + (": " + "; ".join(report.interludes) if report.interludes else ""))
    lines.append(f"Tinted-box macros: {len(report.tinted_box_macros)}"
                 + (": " + ", ".join(t["macro"] for t in report.tinted_box_macros) if report.tinted_box_macros else ""))
    return "\n".join(lines)


def render_md(report: ChapterReport) -> str:
    lines = [f"# chapter_lint: `{report.path}`", ""]
    lines.append(f"{report.total_lines} lines, "
                 f"{sum(1 for s in report.sections if s['kind']=='section')} sections, "
                 f"{sum(1 for s in report.sections if s['kind']=='subsection')} subsections.")
    lines.append("")
    lines.append("| Floor | Status | Detail |")
    lines.append("|---|---|---|")
    for name, f in report.floors.items():
        lines.append(f"| `{name}` | {floor_status(f)} | {f['detail']} |")
    lines.append("")
    lines.append(f"**Claims:** {len(report.claims)} total, "
                 f"{sum(1 for c in report.claims if c['tagged'])} tagged, "
                 f"{sum(1 for c in report.claims if not c['tagged'])} untagged.")
    lines.append("")
    lines.append(f"**Worked examples:** {sum(report.examples_per_section.values())} total, "
                 f"{report.session_count} sessions.")
    lines.append("")
    lines.append(f"**Exercise clusters:** {len(report.exercise_clusters)} "
                 f"({sum(1 for c in report.exercise_clusters if not c['in_exercises_section'])} mid-body).")
    return "\n".join(lines)


def render_consolidated_text(reports: list) -> str:
    """One table across every chapter: (chapter, floor, status, detail) --
    a CI run over many chapters as one screen instead of N separate
    reports. WARN rows (an unmet advisory floor) are printed like any
    other row but never make is_blocking true."""
    rows = []
    for r in reports:
        for name, f in r.floors.items():
            rows.append((r.path, name, floor_status(f), f["detail"].replace("\n", " ")))
    chapter_w = max([len("chapter")] + [len(row[0]) for row in rows]) if rows else len("chapter")
    floor_w = max([len("floor")] + [len(row[1]) for row in rows]) if rows else len("floor")
    lines = [f"{'chapter':<{chapter_w}}  {'floor':<{floor_w}}  status  detail"]
    lines.append("-" * (chapter_w + floor_w + len("  status  detail") + 2))
    for path, name, status, detail in rows:
        lines.append(f"{path:<{chapter_w}}  {name:<{floor_w}}  {status:<6}  {detail}")
    n_blocking = sum(1 for r in reports for f in r.floors.values() if is_blocking(f))
    n_advisory_unmet = sum(1 for r in reports for f in r.floors.values() if f.get("advisory") and not f["ok"])
    lines.append("")
    lines.append(
        f"{len(reports)} chapter(s), {len(rows)} floor row(s): "
        f"{n_blocking} blocking failure(s), {n_advisory_unmet} advisory floor(s) not met."
    )
    return "\n".join(lines)


def render_consolidated_md(reports: list) -> str:
    lines = ["# chapter_lint: consolidated report", ""]
    lines.append(f"{len(reports)} chapter(s).")
    lines.append("")
    lines.append("| Chapter | Floor | Status | Detail |")
    lines.append("|---|---|---|---|")
    for r in reports:
        for name, f in r.floors.items():
            lines.append(f"| `{r.path}` | `{name}` | {floor_status(f)} | {f['detail']} |")
    n_blocking = sum(1 for r in reports for f in r.floors.values() if is_blocking(f))
    n_advisory_unmet = sum(1 for r in reports for f in r.floors.values() if f.get("advisory") and not f["ok"])
    lines.append("")
    lines.append(f"**{n_blocking} blocking failure(s), {n_advisory_unmet} advisory floor(s) not met.**")
    return "\n".join(lines)


def default_chapter_sources(repo_root: Path) -> list:
    """The Book's own chapter list, straight from the `source` field of every
    entry in whitepaper/textbook.json -- so a caller (this script's own CLI
    with no files given, or a CI step) never hard-codes a chapter path list
    that can drift from the manifest that actually governs chapter order.
    Same shape as margin_lint.py's function of the same name."""
    textbook_path = repo_root / "whitepaper" / "textbook.json"
    data = json.loads(textbook_path.read_text(encoding="utf-8"))
    return [repo_root / ch["source"] for ch in data["chapters"]]


def unmet_advisory_keys(reports: list, repo_root: Path) -> list[str]:
    """Stable repo-relative keys for acknowledged WARN rows."""
    root = repo_root.resolve()
    keys = []
    for report in reports:
        path = Path(report.path).resolve()
        try:
            rel = path.relative_to(root)
        except ValueError:
            rel = path
        for name, floor in report.floors.items():
            if floor.get("advisory") and not floor["ok"]:
                keys.append(f"{rel}::{name}")
    return sorted(keys)


def compare_advisory_baseline(current: list[str], baseline: list[str]) -> tuple[list[str], list[str]]:
    """Return (new debt, stale exceptions); both must fail CI."""
    current_set = set(current)
    baseline_set = set(baseline)
    return sorted(current_set - baseline_set), sorted(baseline_set - current_set)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chapters", nargs="*", type=Path,
                     help="Path(s) to .tex chapter file(s); default: every chapter in whitepaper/textbook.json")
    ap.add_argument("--json", action="store_true", help="Emit a JSON report instead of text")
    ap.add_argument("--md", action="store_true", help="Emit a markdown report instead of text")
    ap.add_argument("--strict", action="store_true", help="Exit 1 if any BLOCKING floor is violated (advisory floors never trigger this)")
    ap.add_argument("--advisory-baseline", type=Path,
                    help="Fail if WARN rows differ from this exact JSON list (new debt or stale exceptions)")
    ap.add_argument("--table", action="store_true", help="Force the one-table consolidated report even for a single chapter")
    ap.add_argument("--repo-root", type=Path, default=REPO_ROOT,
                     help="Repository root used to resolve the default chapter list (default: inferred from this script's location)")
    args = ap.parse_args(argv)

    if args.chapters:
        chapters = args.chapters
    else:
        try:
            chapters = default_chapter_sources(args.repo_root)
        except Exception as exc:  # noqa: BLE001
            print(f"error: could not read chapter sources from whitepaper/textbook.json: {exc}", file=sys.stderr)
            return 2

    for c in chapters:
        if not c.exists():
            print(f"error: {c} does not exist", file=sys.stderr)
            return 2

    reports = []
    for c in chapters:
        try:
            reports.append(build_report(c))
        except Exception as exc:  # pragma: no cover - defensive
            print(f"error: could not parse {c}: {exc}", file=sys.stderr)
            return 2

    consolidated = args.table or len(reports) > 1
    if consolidated:
        if args.json:
            print(json.dumps([r.__dict__ for r in reports], indent=2))
        elif args.md:
            print(render_consolidated_md(reports))
        else:
            print(render_consolidated_text(reports))
    else:
        report = reports[0]
        if args.json:
            print(json.dumps(report.__dict__, indent=2))
        elif args.md:
            print(render_md(report))
        else:
            print(render_text(report))

    if args.advisory_baseline:
        try:
            baseline = json.loads(args.advisory_baseline.read_text(encoding="utf-8"))
            if not isinstance(baseline, list) or not all(isinstance(item, str) for item in baseline):
                raise ValueError("baseline must be a JSON array of strings")
        except Exception as exc:  # noqa: BLE001
            print(f"error: could not read advisory baseline: {exc}", file=sys.stderr)
            return 2
        added, resolved = compare_advisory_baseline(
            unmet_advisory_keys(reports, args.repo_root), baseline
        )
        for key in added:
            print(f"error: new advisory template debt: {key}", file=sys.stderr)
        for key in resolved:
            print(f"error: stale advisory exception (remove it): {key}", file=sys.stderr)
        if added or resolved:
            return 1

    any_blocking = any(is_blocking(f) for r in reports for f in r.floors.values())
    if args.strict and any_blocking:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
