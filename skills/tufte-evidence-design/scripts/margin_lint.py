#!/usr/bin/env python3
"""margin_lint.py -- mechanical checks on the Book's margin apparatus.

`references/margin-apparatus.md` states several rules for how a chapter uses
`\\pdmarginfigure`, `\\pdgloss`, and `\\footnote`. Not every rule stated there
is something a script can check without a human judgment call, so this file
enforces only the ones that are genuinely mechanical and reports the rest as
advisory, on the record, in the same run.

Rules, and why each is enforced or advisory:

  one-portrait-per-section   ENFORCED. margin-apparatus.md section 3 records
                              the "at most one per section" rule from
                              HANDOFF-TEXTBOOK.md section 4; a second
                              \\pdmarginfigure in one \\section is a plain
                              count, no judgment required.

  marginalia-has-sidecar     ENFORCED. margin-apparatus.md's practical
                              checklist (section 4, item 3): "Confirm the
                              plate is cleared (plates/marginalia/<slug>.jpg
                              exists, no .NOT-CLEARED.json sidecar) before
                              writing \\pdmarginfigure{slug}{...}." Whether a
                              file exists and a sidecar's fields validate is
                              exactly what a script can check; it reuses
                              scripts/harbor-research/check_marginalia_sidecars.py
                              rather than re-deriving its path or field rules.

  gloss-once-per-chapter     ENFORCED. margin-apparatus.md section 4, item 5
                              (as updated for \\pdgloss): a term should be
                              glossed once, at its first load-bearing use;
                              SKILL.md's anti-pattern section states the same
                              rule against re-glossing a term already
                              introduced. Counting repeated \\pdgloss{Term}
                              calls with the same term in one file needs no
                              judgment.

  gloss-in-running-prose     ENFORCED, as a proxy. margin-apparatus.md
                              requires a margin device to sit in a
                              load-bearing sentence, not stand alone the way
                              a rejected pdmarginfigure candidate was "a
                              bibliography-adjacent mention" with no
                              supporting sentence (section 3, "Held back").
                              A script cannot judge "load-bearing," but it CAN
                              check the mechanical proxy: the paragraph
                              holding the \\pdgloss call has real prose beyond
                              the macro call itself. A \\pdgloss sitting alone
                              in its own paragraph fails this proxy even
                              though the underlying judgment (is the idea
                              load-bearing) is not something this script can
                              make.

  no-footnote-in-body        ADVISORY, not enforced. The task that added this
                              checker asked for "no \\footnote in a chapter
                              body (the Book carries provenance as
                              sidenotes)," but margin-apparatus.md's own Net
                              comparison table records that a numbered,
                              inline sidenote equivalent to tufte-latex's
                              \\sidenote is "not implemented" in this repo.
                              Every \\footnote found in the eight chapters as
                              of this pass is a substantive provenance note
                              pointing at a companion research paper, not a
                              drive-by citation -- rewriting one into a
                              sidenote is an editorial call about where that
                              provenance note should live and how it should
                              read, not a mechanical rename, so this checker
                              reports every \\footnote it finds but does not
                              fail the build on them. Fixing the chapters
                              themselves, or building the missing sidenote
                              macro, is the author's editorial pass.

Usage:
    python3 margin_lint.py [FILE.tex ...] [--json] [--repo-root PATH]

With no FILE arguments, reads the Book's eight chapter sources from the
`source` field of each entry in whitepaper/textbook.json (resolved relative
to --repo-root, default: three levels up from this script).

Exit status: 0 if no ENFORCED rule was violated (advisory findings, such as
every no-footnote-in-body hit, do not affect this); 1 if any ENFORCED rule
was violated; 2 on a usage error (a named file does not exist, or
textbook.json cannot be read/parsed for the no-argument default).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

SECTION_RE = re.compile(r'^\s*\\section\*?\s*\{', re.MULTILINE)
COMMENT_STRIP_RE = re.compile(r'(?<!\\)%.*$', re.MULTILINE)

# A structural line that ends a "paragraph" for gloss-in-running-prose's
# purposes even without a blank line separating it -- a heading, a float, or
# a list item boundary is not running prose.
PARAGRAPH_BOUNDARY_RE = re.compile(
    r'^\s*\\(section|subsection|subsubsection|paragraph|begin|end|item|caption|label)\b'
)

MIN_PROSE_CHARS = 20  # gloss-in-running-prose: non-whitespace chars required
                       # in the paragraph besides the \pdgloss call itself.

RULES = {
    "one-portrait-per-section": "enforced",
    "marginalia-has-sidecar": "enforced",
    "gloss-once-per-chapter": "enforced",
    "gloss-in-running-prose": "enforced",
    "no-footnote-in-body": "advisory",
}


def _load_marginalia_checker():
    """Import scripts/harbor-research/check_marginalia_sidecars.py by path so
    its plates_dir() and check_sidecar() are reused, not re-implemented."""
    path = REPO_ROOT / "scripts" / "harbor-research" / "check_marginalia_sidecars.py"
    spec = importlib.util.spec_from_file_location("check_marginalia_sidecars", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def strip_comments(text: str) -> str:
    """Blank out (not remove -- line numbers must survive) everything from an
    unescaped % to end of line, so a commented-out macro call is never
    scanned as a real one."""
    return COMMENT_STRIP_RE.sub(lambda m: '', text)


def line_of(text: str, index: int) -> int:
    return text.count('\n', 0, index) + 1


def find_macro_calls(text: str, name: str, nargs: int):
    """Find every \\name{arg1}{arg2}... call, brace-balanced per argument (so
    a caption or definition containing its own {}-nested LaTeX, e.g. \\emph{},
    is captured whole rather than truncated at the first inner brace).
    Returns a list of dicts: line, args (list[str]), start, end."""
    calls = []
    pattern = re.compile(r'\\' + re.escape(name) + r'(?![A-Za-z@])')
    for m in pattern.finditer(text):
        pos = m.end()
        args = []
        ok = True
        for _ in range(nargs):
            while pos < len(text) and text[pos] in ' \t':
                pos += 1
            if pos >= len(text) or text[pos] != '{':
                ok = False
                break
            depth = 0
            start = pos
            while pos < len(text):
                c = text[pos]
                if c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        pos += 1
                        break
                pos += 1
            else:
                ok = False
                break
            args.append(text[start + 1:pos - 1])
        if ok:
            calls.append({
                "line": line_of(text, m.start()),
                "args": args,
                "start": m.start(),
                "end": pos,
            })
    return calls


def section_titles_before(text: str):
    """List of (line, title_start_index) for every \\section/\\section* in
    document order -- used to attribute a \\pdmarginfigure to its owning
    section. Subsections are deliberately NOT boundaries: margin-apparatus.md
    section 3 records a soft conflict between two portraits in different
    SUBSECTIONS of the same SECTION, so the quota is per \\section."""
    out = []
    for m in SECTION_RE.finditer(text):
        out.append(m.start())
    return out


def owning_section_index(section_starts, call_start: int) -> int:
    """Index into section_starts of the last section beginning at or before
    call_start, or -1 if the call precedes every \\section (e.g. an
    introduction before the first heading)."""
    idx = -1
    for i, s in enumerate(section_starts):
        if s <= call_start:
            idx = i
        else:
            break
    return idx


def check_one_portrait_per_section(path: str, text: str, findings: list):
    calls = find_macro_calls(text, "pdmarginfigure", 2)
    if not calls:
        return
    sections = section_titles_before(text)
    by_section: dict[int, list] = {}
    for call in calls:
        sec = owning_section_index(sections, call["start"])
        by_section.setdefault(sec, []).append(call)
    for sec, calls_in_section in by_section.items():
        if len(calls_in_section) <= 1:
            continue
        first = calls_in_section[0]
        for extra in calls_in_section[1:]:
            findings.append({
                "file": path,
                "line": extra["line"],
                "rule": "one-portrait-per-section",
                "severity": "enforced",
                "message": (
                    f"a second \\pdmarginfigure ({extra['args'][0]!r}) appears in the same "
                    f"section as the one at line {first['line']} ({first['args'][0]!r}) -- "
                    "margin-apparatus.md section 3's \"at most one per section\" rule"
                ),
            })


def check_marginalia_sidecars(path: str, text: str, findings: list, sidecar_mod, repo_root: str):
    calls = find_macro_calls(text, "pdmarginfigure", 2)
    if not calls:
        return
    dir_path = sidecar_mod.plates_dir(repo_root)
    seen_slugs = set()
    for call in calls:
        slug = call["args"][0].strip()
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        jpg_path = os.path.join(dir_path, f"{slug}.jpg")
        if not os.path.exists(jpg_path):
            findings.append({
                "file": path,
                "line": call["line"],
                "rule": "marginalia-has-sidecar",
                "severity": "enforced",
                "message": (
                    f"\\pdmarginfigure{{{slug}}} has no plate at "
                    f"website-v2/public/whitepaper/plates/marginalia/{slug}.jpg -- "
                    "margin-apparatus.md section 4, item 3"
                ),
            })
            continue
        sidecar_path = os.path.join(dir_path, f"{slug}.json")
        failures = sidecar_mod.check_sidecar(slug, sidecar_path)
        for failure in failures:
            findings.append({
                "file": path,
                "line": call["line"],
                "rule": "marginalia-has-sidecar",
                "severity": "enforced",
                "message": (
                    f"\\pdmarginfigure{{{slug}}}: {failure} -- "
                    "margin-apparatus.md section 4, item 3"
                ),
            })


def check_gloss_once_per_chapter(path: str, text: str, findings: list):
    calls = find_macro_calls(text, "pdgloss", 2)
    seen: dict[str, dict] = {}
    for call in calls:
        term = call["args"][0].strip()
        key = term.casefold()
        if key in seen:
            findings.append({
                "file": path,
                "line": call["line"],
                "rule": "gloss-once-per-chapter",
                "severity": "enforced",
                "message": (
                    f"\\pdgloss{{{term}}} repeats a term already glossed at line "
                    f"{seen[key]['line']} in this chapter -- margin-apparatus.md section 4, "
                    "item 5 and SKILL.md's \"reaching for \\pdgloss a second time\" anti-pattern"
                ),
            })
        else:
            seen[key] = call


def check_gloss_in_running_prose(path: str, text: str, findings: list):
    calls = find_macro_calls(text, "pdgloss", 2)
    if not calls:
        return
    lines = text.split('\n')
    line_starts = [0]
    for ln in lines:
        line_starts.append(line_starts[-1] + len(ln) + 1)

    for call in calls:
        call_line_idx = call["line"] - 1  # 0-based
        # Walk up and down from the call's own line to the paragraph
        # boundary: a blank line, or a structural LaTeX line.
        top = call_line_idx
        while top - 1 >= 0 and lines[top - 1].strip() != '' and not PARAGRAPH_BOUNDARY_RE.match(lines[top - 1]):
            top -= 1
        bottom = call_line_idx
        while bottom + 1 < len(lines) and lines[bottom + 1].strip() != '' and not PARAGRAPH_BOUNDARY_RE.match(lines[bottom + 1]):
            bottom += 1
        paragraph_text = '\n'.join(lines[top:bottom + 1])

        call_text = text[call["start"]:call["end"]]
        remainder = paragraph_text.replace(call_text, '', 1)
        prose_chars = len(re.sub(r'\s+', '', remainder))
        if prose_chars < MIN_PROSE_CHARS:
            findings.append({
                "file": path,
                "line": call["line"],
                "rule": "gloss-in-running-prose",
                "severity": "enforced",
                "message": (
                    f"\\pdgloss{{{call['args'][0]}}} sits with no surrounding sentence "
                    "(fewer than 20 non-whitespace characters of prose in its paragraph) -- "
                    "margin-apparatus.md's load-bearing-sentence principle, applied to \\pdgloss"
                ),
            })


def check_no_footnote_in_body(path: str, text: str, findings: list):
    for m in re.finditer(r'\\footnote\s*\{', text):
        findings.append({
            "file": path,
            "line": line_of(text, m.start()),
            "rule": "no-footnote-in-body",
            "severity": "advisory",
            "message": (
                "\\footnote in a chapter body -- the task's own rule is \"the Book carries "
                "provenance as sidenotes,\" but margin-apparatus.md's Net comparison table "
                "records a numbered inline sidenote (tufte-latex's \\sidenote) as \"not "
                "implemented\" here, so converting this call is an editorial rewrite, not a "
                "mechanical one; reported, not failed"
            ),
        })


def lint_file(path: str, repo_root: str, sidecar_mod) -> list:
    raw = Path(path).read_text(encoding="utf-8")
    text = strip_comments(raw)
    findings: list = []
    check_one_portrait_per_section(path, text, findings)
    check_marginalia_sidecars(path, text, findings, sidecar_mod, repo_root)
    check_gloss_once_per_chapter(path, text, findings)
    check_gloss_in_running_prose(path, text, findings)
    check_no_footnote_in_body(path, text, findings)
    findings.sort(key=lambda f: (f["line"], f["rule"]))
    return findings


def default_chapter_sources(repo_root: str) -> list:
    textbook_path = Path(repo_root) / "whitepaper" / "textbook.json"
    data = json.loads(textbook_path.read_text(encoding="utf-8"))
    return [str(Path(repo_root) / ch["source"]) for ch in data["chapters"]]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", help="chapter .tex files to lint; default: the eight Book chapters from whitepaper/textbook.json")
    parser.add_argument("--json", action="store_true", help="emit findings as JSON instead of file:line text")
    parser.add_argument("--repo-root", default=str(REPO_ROOT), help="repository root (default: inferred from this script's location)")
    args = parser.parse_args(argv)

    repo_root = str(Path(args.repo_root).resolve())

    if args.files:
        files = args.files
    else:
        try:
            files = default_chapter_sources(repo_root)
        except Exception as exc:  # noqa: BLE001
            print(f"margin_lint.py: could not read chapter sources from whitepaper/textbook.json: {exc}", file=sys.stderr)
            return 2

    for f in files:
        if not Path(f).is_file():
            print(f"margin_lint.py: no such file: {f}", file=sys.stderr)
            return 2

    sidecar_mod = _load_marginalia_checker()

    all_findings: list = []
    for f in files:
        all_findings.extend(lint_file(f, repo_root, sidecar_mod))

    if args.json:
        print(json.dumps(all_findings, indent=2))
    else:
        if not all_findings:
            print("margin_lint: no findings")
        for finding in all_findings:
            tag = "ADVISORY" if finding["severity"] == "advisory" else "FAIL"
            print(f"{finding['file']}:{finding['line']}: [{tag}] {finding['rule']}: {finding['message']}")
        enforced = [f for f in all_findings if f["severity"] == "enforced"]
        advisory = [f for f in all_findings if f["severity"] == "advisory"]
        print(f"\n{len(enforced)} enforced finding(s), {len(advisory)} advisory finding(s) across {len(files)} file(s)")

    return 1 if any(f["severity"] == "enforced" for f in all_findings) else 0


if __name__ == "__main__":
    sys.exit(main())
