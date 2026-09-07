#!/usr/bin/env python3
"""chapter_lint.py -- report a LaTeX chapter's structure against the
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

Exit code: 0 always, unless --strict is given and at least one floor is
violated (then 1), or the file cannot be read/parsed (then 2). stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

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


def strip_comments(text: str) -> str:
    """Drop LaTeX line comments (unescaped %) so a commented-out macro call
    is never mistaken for a live one. Does not attempt to handle \\% ."""
    out_lines = []
    for line in text.split("\n"):
        i = 0
        while True:
            idx = line.find("%", i)
            if idx == -1:
                out_lines.append(line)
                break
            if idx > 0 and line[idx - 1] == "\\":
                i = idx + 1
                continue
            out_lines.append(line[:idx])
            break
    return "\n".join(out_lines)


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


@dataclass
class Section:
    kind: str  # "section" or "subsection"
    title: str
    start: int  # char offset
    line: int
    end: int = -1  # char offset of next same-or-higher-level heading, or EOF
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
        title, end = balanced_brace_arg(text, m.end() - 1)
        title = re.sub(r"\\label\{[^}]*\}", "", title or "").strip()
        sections.append(Section(kind=kind, title=title, start=m.start(), line=line_of(text, m.start())))
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


def enclosing_top_section(sections, pos: int) -> str:
    """The nearest top-level \\section title enclosing character offset pos,
    or "(preamble/front matter)" if pos precedes the first section."""
    best = None
    for s in sections:
        if s.kind == "section" and s.start <= pos < s.end:
            best = s.title
    return best or "(preamble/front matter)"


def find_claims(text: str, sections):
    claims = []
    for env in CLAIM_ENVS:
        for m in re.finditer(r"\\begin\{" + env + r"\}(\[[^\]]*\])?", text):
            title = (m.group(1) or "")[1:-1] if m.group(1) else ""
            pos = m.end()
            window = text[max(0, m.start() - 200) : pos + 400]
            tag = EPISTEMIC_TAG_RE.search(window)
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


def find_exercise_clusters(text: str, sections):
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
                in_exercises_section=bool(EXERCISES_SECTION_TITLE_RE.search(title)),
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
                    in_exercises_section=bool(EXERCISES_SECTION_TITLE_RE.search(title)),
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
    return bool(PD_PEDAGOGY_INPUT_RE.search(text))


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
        "detail": (
            f"{len(sections_with_zero_examples)}/{len(top_sections)} top-level sections have zero "
            "worked examples (pdexample/example): "
            + "; ".join(sections_with_zero_examples[:8])
            + (" ..." if len(sections_with_zero_examples) > 8 else "")
        )
        if sections_with_zero_examples
        else f"all {len(top_sections)} top-level sections have >=1 worked example",
    }

    mid_body = [c for c in exercise_clusters if not c.in_exercises_section]
    report.floors["exercises_at_chapter_end"] = {
        "ok": not mid_body,
        "detail": (
            f"{len(mid_body)}/{len(exercise_clusters)} exercise clusters sit mid-body, outside a "
            "section titled 'Exercises' (Wave 12 finding F1: this is the exact defect the "
            "chapter-end apparatus was built to fix). Lines: "
            + ", ".join(str(c.line) for c in mid_body[:12])
            + (" ..." if len(mid_body) > 12 else "")
        )
        if mid_body
        else (
            f"all {len(exercise_clusters)} exercise clusters sit inside a chapter-end 'Exercises' section"
            if exercise_clusters
            else "no exercise clusters found"
        ),
    }

    untagged = [c for c in claims if not c.tagged]
    report.floors["claims_carry_epistemic_kind"] = {
        "ok": not untagged,
        "detail": (
            f"{len(untagged)}/{len(claims)} claim-like environments (theorem/lemma/definition/"
            "property/corollary) carry no nearby epistemic-kind tag (pdclaim kind, or a "
            "\\Built/\\Designed/\\pdassurance-style maturity marker) -- the honesty ledger "
            "requires every claim state its own kind where it is made. Lines: "
            + ", ".join(f"{c.line} ({c.env})" for c in untagged[:12])
            + (" ..." if len(untagged) > 12 else "")
        )
        if untagged
        else (f"all {len(claims)} claims carry an epistemic-kind tag" if claims else "no claim-like environments found"),
    }

    pd_pedagogy = imports_pd_pedagogy(text)
    if tinted and pd_pedagogy:
        report.floors["no_tinted_box_macros"] = {
            "ok": True,
            "detail": (
                f"{len(tinted)} legacy tinted-box macro(s) defined with a fill= node, but this "
                "chapter \\input{s} figures/pd-pedagogy, whose \\AtBeginDocument re-typesets "
                "\\keyidea/\\pitfall/\\scene/\\xrefbox/\\pullquote as a run-in or margin head with "
                "plain prose -- the preamble definitions are cosmetic leftovers, not live at "
                "render time: " + ", ".join(f"{t['macro']} (line {t['line']})" for t in tinted)
            ),
        }
    else:
        report.floors["no_tinted_box_macros"] = {
            "ok": not tinted,
            "detail": (
                f"{len(tinted)} legacy tinted-box macro(s) defined with a fill= node, and this "
                "chapter does NOT \\input{figures/pd-pedagogy} to neutralize them -- they render "
                "as tinted rectangles (page grammar requires typography + margin, never a fill): "
                + ", ".join(f"{t['macro']} (line {t['line']})" for t in tinted)
            )
            if tinted
            else "no tinted-box macro definitions found",
        }

    report.floors["at_most_one_interlude"] = {
        "ok": len(interludes) <= 1,
        "detail": f"{len(interludes)} interlude(s): " + "; ".join(interludes) if interludes else "0 interludes",
    }

    missing_close = [k for k, v in chapter_close.items() if not v["present"]]
    report.floors["chapter_close_apparatus"] = {
        "ok": not missing_close,
        "detail": (
            "missing: " + ", ".join(missing_close)
            if missing_close
            else "review/history/boundary sections all present (by title keyword match)"
        ),
    }

    return report


def render_text(report: ChapterReport) -> str:
    lines = []
    lines.append(f"chapter_lint: {report.path}  ({report.total_lines} lines, "
                 f"{sum(1 for s in report.sections if s['kind']=='section')} sections, "
                 f"{sum(1 for s in report.sections if s['kind']=='subsection')} subsections)")
    lines.append(f"  imports figures/pd-pedagogy: {report.imports_pd_pedagogy}")
    lines.append("")
    lines.append("Floors:")
    for name, f in report.floors.items():
        mark = "PASS" if f["ok"] else "FAIL"
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
        lines.append(f"| `{name}` | {'PASS' if f['ok'] else 'FAIL'} | {f['detail']} |")
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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chapter", type=Path, help="Path to a .tex chapter file")
    ap.add_argument("--json", action="store_true", help="Emit a JSON report instead of text")
    ap.add_argument("--md", action="store_true", help="Emit a markdown report instead of text")
    ap.add_argument("--strict", action="store_true", help="Exit 1 if any floor is violated")
    args = ap.parse_args(argv)

    if not args.chapter.exists():
        print(f"error: {args.chapter} does not exist", file=sys.stderr)
        return 2
    try:
        report = build_report(args.chapter)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"error: could not parse {args.chapter}: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report.__dict__, indent=2))
    elif args.md:
        print(render_md(report))
    else:
        print(render_text(report))

    if args.strict and any(not f["ok"] for f in report.floors.values()):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
