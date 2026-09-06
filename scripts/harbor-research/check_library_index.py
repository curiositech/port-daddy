#!/usr/bin/env python3
"""check_library_index.py -- checks docs/harbor-research/library-index.json against
the actual LaTeX corpora it claims to index.

Reuses, rather than duplicates:
  - check_citations.py: REPO_ROOT resolution, the \\input/\\include resolver's
    regex (INPUT_RE) and comment-stripper (strip_comments), CORPUS_PATTERNS and
    discover_corpus_files() for "the three corpora", and is_excluded() for the
    .claude/worktrees exclusion.
  - check_propagated_corrections.py: strip_latex_comments(), used when scanning a
    single named file's full text for a number's regex (drift check).

The index (docs/harbor-research/library-index.json) is the source of record for
"where does each idea (R1-R17, CR, B6, and every already-folded textbook theorem)
live". This script is the thing that keeps the index honest:

  (a) existence   -- every label/anchor/file/script/figure/mechanization path an
                      entry names actually exists where the entry says it does.
  (b) coverage    -- every \\label{thm:...|lem:...|prop:...|cor:...|def:...|conj:...}
                      and every \\begin{theorem|lemma|proposition|corollary|
                      definition|conjecture} in the three corpora is claimed by
                      some entry or listed in unindexed_allow with a reason, and
                      every one of those \\begin{...} environments carries a
                      \\label of its own (an unlabeled one must be allow-listed
                      by a synthetic "unlabeled-env:<file>:<line>" id).
  (c) drift       -- every numbers[].regex matches inside the entry's standalone
                      file AND inside every one of its chapters[] files.
  (d) twin header -- both files of every folded pair carry the TWIN-LOCATION
                      NOTICE header (naming each other and the entry's id).
  (e) prefix      -- every chapter source's \\newcommand{\\pdchapterprefix}{...}
                      equals whitepaper/textbook.json's prefix for that chapter,
                      and the entry's own "prefix"/"chapter" fields agree with it.
  (f) LIBRARY-INDEX.md -- --write-md regenerates it; --check-md fails if stale.

Usage:
    python3 scripts/harbor-research/check_library_index.py [--verbose]
    python3 scripts/harbor-research/check_library_index.py --write-md
    python3 scripts/harbor-research/check_library_index.py --check-md

Exit status: 0 iff checks (a)-(e) all pass (and, with --check-md, the generated
Markdown matches what's on disk). --write-md always exits 0 after writing unless
(a)-(e) also fail, so a habitual `--write-md` in a pre-commit hook still surfaces
a broken index.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from dataclasses import dataclass, field

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import check_citations as cc  # noqa: E402  (reused: REPO_ROOT, INPUT_RE, strip_comments, discover_corpus_files, is_excluded, rel)
import check_propagated_corrections as cpc  # noqa: E402  (reused: strip_latex_comments)

REPO_ROOT = cc.REPO_ROOT  # overridable below for tests, via --repo-root
INDEX_REL = "docs/harbor-research/library-index.json"
SCHEMA_REL = "docs/harbor-research/library-index.schema.json"
MD_REL = "docs/harbor-research/LIBRARY-INDEX.md"
TEXTBOOK_REL = "whitepaper/textbook.json"

THM_FAMILY_ENVS = ["theorem", "lemma", "proposition", "corollary", "definition", "conjecture"]
LABEL_PREFIXES = ["thm", "lem", "prop", "cor", "def", "conj"]

PREFIXED_LABEL_RE = re.compile(r"\\label\{((?:%s):[a-zA-Z0-9_.-]+)\}" % "|".join(LABEL_PREFIXES))
ANY_LABEL_RE = re.compile(r"\\label\{([^}]+)\}")
ENV_BEGIN_RE = re.compile(r"\\begin\{(%s)\}" % "|".join(THM_FAMILY_ENVS))
PDCHAPTERPREFIX_RE = re.compile(r"\\newcommand\{\\pdchapterprefix\}\{([a-zA-Z0-9_-]+)\}")
DOCUMENTCLASS_RE = re.compile(r"\\documentclass")
TWIN_MARKER = "TWIN-LOCATION NOTICE"


def rel(path: str) -> str:
    return os.path.relpath(path, REPO_ROOT)


def abspath(rel_path: str) -> str:
    return os.path.join(REPO_ROOT, rel_path)


def read_text(rel_path: str) -> str | None:
    p = abspath(rel_path)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()


# ---------------------------------------------------------------------------
# \input/\include resolution over the three corpora -- reuses check_citations'
# INPUT_RE and strip_comments rather than reimplementing comment-aware
# \input scanning; only collects the *set of reachable files*, since that is
# all the coverage/drift checks need (bibitems/cites are check_citations' job).
# ---------------------------------------------------------------------------

def resolve_reachable_files(top_path: str) -> set[str]:
    reachable: set[str] = set()

    def walk(path: str, depth: int) -> None:
        ap = os.path.normpath(path)
        if ap in reachable or depth > 15 or not os.path.isfile(ap):
            return
        reachable.add(ap)
        file_dir = os.path.dirname(ap)
        with open(ap, encoding="utf-8", errors="replace") as fh:
            for raw_line in fh:
                code = cc.strip_comments(raw_line.rstrip("\n"))
                for m in cc.INPUT_RE.finditer(code):
                    target = m.group(1).strip()
                    if not target.lower().endswith(".tex"):
                        target += ".tex"
                    walk(os.path.join(file_dir, target), depth + 1)

    walk(top_path, 0)
    return reachable


def _is_excluded_relative(path: str) -> bool:
    """Like check_citations.is_excluded(), but tests for a NESTED worktree
    marker relative to REPO_ROOT rather than in the absolute path.

    check_citations.py's own is_excluded() checks `WORKTREE_MARKER in path`
    against the *absolute* path, which is correct when scanning from a normal
    checkout but is always-true -- excluding every file, corpus included --
    when REPO_ROOT itself happens to be served from inside a
    .claude/worktrees/<id>/ directory, exactly as a single agent session's own
    working copy legitimately is. check_citations.py is a reused dependency,
    not a file this task edits, so this checker works around the false
    positive here instead: a path is excluded only when the worktree marker
    appears *below* REPO_ROOT (a genuinely nested, stale copy of the corpus),
    never merely because REPO_ROOT's own path contains it."""
    try:
        r = os.path.relpath(path, REPO_ROOT)
    except ValueError:
        return cc.is_excluded(path)
    return cc.WORKTREE_MARKER in r


def discover_corpus_files() -> list[str]:
    """Reimplements check_citations.discover_corpus_files()'s glob loop
    (reusing its CORPUS_PATTERNS) with the corrected exclusion above."""
    files: list[str] = []
    for pattern in cc.CORPUS_PATTERNS:
        for path in sorted(glob.glob(os.path.join(REPO_ROOT, pattern))):
            if os.path.isfile(path) and not _is_excluded_relative(path):
                files.append(path)
    return files


def all_corpus_files() -> set[str]:
    """Union of every file reachable (via \\input/\\include) from any top-level
    file in the three corpora check_citations.py defines. A file \\input'ed by
    more than one top-level document (a shared figure fragment) is scanned once."""
    files: set[str] = set()
    for top in discover_corpus_files():
        files |= resolve_reachable_files(top)
    return files


# ---------------------------------------------------------------------------
# Loading the index
# ---------------------------------------------------------------------------

class IndexError_(Exception):
    pass


def load_index() -> dict:
    path = abspath(INDEX_REL)
    if not os.path.isfile(path):
        raise IndexError_(f"{INDEX_REL} does not exist")
    with open(path, encoding="utf-8") as fh:
        try:
            data = json.load(fh)
        except json.JSONDecodeError as e:
            raise IndexError_(f"{INDEX_REL} is not valid JSON: {e}") from e
    for key in ("$schema", "version", "entries", "unindexed_allow"):
        if key not in data:
            raise IndexError_(f"{INDEX_REL} is missing top-level key '{key}'")
    if not isinstance(data["entries"], list):
        raise IndexError_(f"{INDEX_REL}: 'entries' must be a list")
    if not isinstance(data["unindexed_allow"], list):
        raise IndexError_(f"{INDEX_REL}: 'unindexed_allow' must be a list")
    seen_ids: set[str] = set()
    for i, e in enumerate(data["entries"]):
        eid = e.get("id")
        if not eid:
            raise IndexError_(f"{INDEX_REL}: entries[{i}] has no 'id'")
        if eid in seen_ids:
            raise IndexError_(f"{INDEX_REL}: duplicate entry id '{eid}'")
        seen_ids.add(eid)
        for req in ("kind", "title", "one_breath", "standalone", "chapters",
                    "figures", "scripts", "numbers", "mechanization", "site", "status"):
            if req not in e:
                raise IndexError_(f"{INDEX_REL}: entry '{eid}' is missing '{req}'")
    for i, a in enumerate(data["unindexed_allow"]):
        for req in ("id", "file", "reason"):
            if req not in a:
                raise IndexError_(f"{INDEX_REL}: unindexed_allow[{i}] is missing '{req}'")
    return data


def load_textbook() -> dict:
    path = abspath(TEXTBOOK_REL)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Check (a): existence
# ---------------------------------------------------------------------------

def check_existence(index: dict) -> list[str]:
    failures: list[str] = []

    def check_location(entry_id: str, role: str, loc: dict | None) -> None:
        if loc is None:
            return
        f = loc["file"]
        text = read_text(f)
        if text is None:
            failures.append(f"{entry_id}: {role} file does not exist: {f}")
            return
        for label in loc.get("labels", []):
            if f"\\label{{{label}}}" not in text:
                failures.append(
                    f"{entry_id}: {role} label '{label}' not found in {f} "
                    f"(expected literal \\label{{{label}}})"
                )

    for e in index["entries"]:
        eid = e["id"]
        check_location(eid, "standalone", e.get("standalone"))
        for ch in e.get("chapters", []):
            check_location(eid, f"chapter[{ch.get('file')}]", ch)
            if not os.path.isfile(abspath(ch["file"])):
                failures.append(f"{eid}: chapter file does not exist: {ch['file']}")
        for kind in ("figures", "scripts", "mechanization"):
            for p in e.get(kind, []):
                if not os.path.isfile(abspath(p)):
                    failures.append(f"{eid}: {kind} path does not exist: {p}")

    for a in index["unindexed_allow"]:
        if not os.path.isfile(abspath(a["file"])):
            failures.append(
                f"unindexed_allow entry '{a['id']}': file does not exist: {a['file']}"
            )

    return failures


# ---------------------------------------------------------------------------
# Check (b): coverage
# ---------------------------------------------------------------------------

def _split_thm_family_blocks(text: str) -> list[tuple[str, int, int]]:
    """Return (env_name, begin_line_1based, end_line_1based) for every
    top-level theorem-family \\begin{...}...\\end{...} in text, matching each
    \\begin to the next \\end of the SAME env name (no nesting is expected for
    these environments in this corpus; a missing \\end extends to EOF)."""
    lines = text.split("\n")
    blocks: list[tuple[str, int, int]] = []
    open_envs: list[tuple[str, int]] = []  # (env, begin_line) stack per env name
    for lineno, raw in enumerate(lines, start=1):
        code = cc.strip_comments(raw)
        for m in ENV_BEGIN_RE.finditer(code):
            open_envs.append((m.group(1), lineno))
        for env in THM_FAMILY_ENVS:
            if re.search(r"\\end\{%s\}" % env, code):
                for idx in range(len(open_envs) - 1, -1, -1):
                    if open_envs[idx][0] == env:
                        _, begin = open_envs.pop(idx)
                        blocks.append((env, begin, lineno))
                        break
    for env, begin in open_envs:
        blocks.append((env, begin, len(lines)))
    return blocks


def check_coverage(index: dict, files: set[str]) -> list[str]:
    failures: list[str] = []

    claimed_labels: set[tuple[str, str]] = set()  # (relfile, label)
    for e in index["entries"]:
        st = e.get("standalone")
        if st:
            for label in st.get("labels", []):
                claimed_labels.add((st["file"], label))
        for ch in e.get("chapters", []):
            for label in ch.get("labels", []):
                claimed_labels.add((ch["file"], label))

    allow_ids: set[tuple[str, str]] = {(a["file"], a["id"]) for a in index["unindexed_allow"]}

    for abs_path in sorted(files):
        rel_path = rel(abs_path)
        with open(abs_path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        stripped = "\n".join(cc.strip_comments(line) for line in text.split("\n"))

        for m in PREFIXED_LABEL_RE.finditer(stripped):
            label = m.group(1)
            if (rel_path, label) in claimed_labels or (rel_path, label) in allow_ids:
                continue
            line_no = stripped[: m.start()].count("\n") + 1
            failures.append(
                f"coverage: {rel_path}:{line_no}: \\label{{{label}}} is not claimed by any "
                f"entry's labels[] and is not in unindexed_allow"
            )

        for env, begin, end in _split_thm_family_blocks(text):
            block_text = "\n".join(text.split("\n")[begin - 1: end])
            block_stripped = "\n".join(
                cc.strip_comments(line) for line in block_text.split("\n")
            )
            label_match = ANY_LABEL_RE.search(block_stripped)
            if label_match:
                label = label_match.group(1)
                if PREFIXED_LABEL_RE.match(f"\\label{{{label}}}"):
                    continue  # already checked above via the prefixed-label scan
                if (rel_path, label) in claimed_labels or (rel_path, label) in allow_ids:
                    continue
                failures.append(
                    f"coverage: {rel_path}:{begin}: \\begin{{{env}}} carries \\label{{{label}}}, "
                    f"which has no thm:/lem:/prop:/cor:/def:/conj: prefix and is not claimed or allowed"
                )
            else:
                synthetic_id = f"unlabeled-env:{rel_path}:{begin}"
                if (rel_path, synthetic_id) in allow_ids:
                    continue
                failures.append(
                    f"coverage: {rel_path}:{begin}: \\begin{{{env}}} has no \\label (every "
                    f"theorem-family environment must carry one); allow it with id "
                    f"'{synthetic_id}' in unindexed_allow if it cannot be labelled this wave"
                )

    return failures


# ---------------------------------------------------------------------------
# Check (c): drift
# ---------------------------------------------------------------------------

def check_drift(index: dict) -> list[str]:
    failures: list[str] = []
    for e in index["entries"]:
        eid = e["id"]
        locations: list[tuple[str, str]] = []  # (role, file)
        st = e.get("standalone")
        if st:
            locations.append(("standalone", st["file"]))
        for ch in e.get("chapters", []):
            locations.append((f"chapter[{ch['file']}]", ch["file"]))

        for n in e.get("numbers", []):
            name, regex = n["name"], n["regex"]
            try:
                pattern = re.compile(regex)
            except re.error as exc:
                failures.append(f"{eid}: numbers[{name}].regex is not a valid Python regex: {exc}")
                continue
            for role, f in locations:
                text = read_text(f)
                if text is None:
                    continue  # already reported by check (a)
                stripped = cpc.strip_latex_comments(text)
                if not pattern.search(stripped):
                    failures.append(
                        f"drift: {eid}: numbers[{name}] (regex {regex!r}, value {n['value']!r}) "
                        f"not found in {role} file {f}"
                    )
    return failures


# ---------------------------------------------------------------------------
# Check (d): twin header
# ---------------------------------------------------------------------------

def _leading_comment_block(text: str) -> str:
    m = DOCUMENTCLASS_RE.search(text)
    return text[: m.start()] if m else text


def check_twin_headers(index: dict) -> list[str]:
    failures: list[str] = []
    # Collect, per file, the set of (partner_file, entry_id) pairs it must
    # advertise -- a chapter folded from two different papers (or a paper
    # folded into two different chapters) must name every partner, not just one.
    obligations: dict[str, list[tuple[str, str]]] = {}

    for e in index["entries"]:
        if e.get("status") != "folded":
            continue
        st = e.get("standalone")
        chapters = e.get("chapters", [])
        if not st or not chapters:
            continue  # "folded" but missing one side is caught by other checks
        for ch in chapters:
            obligations.setdefault(st["file"], []).append((ch["file"], e["id"]))
            obligations.setdefault(ch["file"], []).append((st["file"], e["id"]))

    for f, partners in obligations.items():
        text = read_text(f)
        if text is None:
            continue  # reported by check (a)
        header = _leading_comment_block(text)
        if TWIN_MARKER not in header:
            failures.append(
                f"twin-header: {f} is folded (partners: "
                f"{', '.join(sorted({p for p, _ in partners}))}) but its header before "
                f"\\documentclass does not contain '{TWIN_MARKER}'"
            )
            continue
        for partner_file, entry_id in partners:
            partner_name = os.path.basename(partner_file)
            if partner_name not in header and partner_file not in header:
                failures.append(
                    f"twin-header: {f}'s TWIN-LOCATION NOTICE does not name its partner "
                    f"{partner_file} (entry {entry_id})"
                )
            if entry_id not in header:
                failures.append(
                    f"twin-header: {f}'s TWIN-LOCATION NOTICE does not list index id "
                    f"'{entry_id}' among its Index ids"
                )
    return failures


# ---------------------------------------------------------------------------
# Check (e): chapter prefix
# ---------------------------------------------------------------------------

def check_chapter_prefix(index: dict, textbook: dict) -> list[str]:
    failures: list[str] = []
    by_source = {c["source"]: c for c in textbook["chapters"]}

    seen_files: set[str] = set()
    for e in index["entries"]:
        for ch in e.get("chapters", []):
            f = ch["file"]
            if f in seen_files:
                continue
            seen_files.add(f)
            tb_chapter = by_source.get(f)
            if tb_chapter is None:
                failures.append(
                    f"prefix: chapter file {f} (entry {e['id']}) is not any chapter's "
                    f"\"source\" in {TEXTBOOK_REL}"
                )
                continue
            if ch.get("chapter") != tb_chapter["number"]:
                failures.append(
                    f"prefix: {f}: index says chapter {ch.get('chapter')}, "
                    f"{TEXTBOOK_REL} says {tb_chapter['number']}"
                )
            if ch.get("prefix") != tb_chapter["prefix"]:
                failures.append(
                    f"prefix: {f}: index says prefix '{ch.get('prefix')}', "
                    f"{TEXTBOOK_REL} says '{tb_chapter['prefix']}'"
                )
            text = read_text(f)
            if text is None:
                continue
            m = PDCHAPTERPREFIX_RE.search(text)
            if not m:
                failures.append(f"prefix: {f} has no \\newcommand{{\\pdchapterprefix}}{{...}}")
            elif m.group(1) != tb_chapter["prefix"]:
                failures.append(
                    f"prefix: {f}: \\pdchapterprefix is '{m.group(1)}', "
                    f"{TEXTBOOK_REL} says '{tb_chapter['prefix']}'"
                )
    return failures


# ---------------------------------------------------------------------------
# Markdown generation (check f)
# ---------------------------------------------------------------------------

def _md_escape(s: str) -> str:
    return s.replace("|", "\\|")


def generate_markdown(index: dict, textbook: dict) -> str:
    by_number = {c["number"]: c for c in textbook["chapters"]}
    lines: list[str] = []
    lines.append("# Library Index")
    lines.append("")
    lines.append(
        "Generated by `scripts/harbor-research/check_library_index.py --write-md`. "
        "Do not hand-edit; edit `docs/harbor-research/library-index.json` and regenerate."
    )
    lines.append("")
    lines.append(
        "One section per indexed idea (R1-R17, CR, B6, and every already-folded "
        "textbook theorem): where it is proved, where it is retold, what draws it, "
        "what computes its numbers, and what mechanizes it."
    )
    lines.append("")
    lines.append("## Contents")
    lines.append("")
    for e in index["entries"]:
        lines.append(f"- [{e['id']} -- {_md_escape(e['title'])}](#{e['id'].lower().replace(':', '')})")
    lines.append("")

    for e in index["entries"]:
        anchor = e["id"].lower().replace(":", "")
        lines.append(f"## {e['id']} -- {e['title']}")
        lines.append(f'<a id="{anchor}"></a>')
        lines.append("")
        lines.append(f"**Kind:** {e['kind']}  **Status:** {e['status']}")
        lines.append("")
        lines.append(f"> {e['one_breath']}")
        lines.append("")
        lines.append("| Location | File | Labels | Sections |")
        lines.append("|---|---|---|---|")
        st = e.get("standalone")
        if st:
            lines.append(
                f"| Standalone paper | `{st['file']}` | "
                f"{_md_escape(', '.join(st['labels']) or '(none)')} | "
                f"{_md_escape('; '.join(st['sections']) or '(none)')} |"
            )
        else:
            lines.append("| Standalone paper | *(none -- see status)* | | |")
        for ch in e.get("chapters", []):
            tb = by_number.get(ch["chapter"], {})
            chap_title = tb.get("title", "?")
            lines.append(
                f"| Chapter {ch['chapter']} ({_md_escape(chap_title)}) | `{ch['file']}` | "
                f"{_md_escape(', '.join(ch['labels']) or '(none)')} | "
                f"{_md_escape('; '.join(ch['sections']) or '(none)')} |"
            )
        if not e.get("chapters"):
            lines.append("| Chapters | *(not yet folded)* | | |")
        lines.append("")

        if e.get("figures"):
            lines.append("**Figures:** " + ", ".join(f"`{p}`" for p in e["figures"]))
            lines.append("")
        if e.get("scripts"):
            lines.append("**Scripts:** " + ", ".join(f"`{p}`" for p in e["scripts"]))
            lines.append("")
        if e.get("mechanization"):
            lines.append("**Mechanization:** " + ", ".join(f"`{p}`" for p in e["mechanization"]))
            lines.append("")
        if e.get("site"):
            lines.append("**Site:** " + ", ".join(f"`{p}`" for p in e["site"]))
            lines.append("")
        if e.get("numbers"):
            lines.append("| Number | Value | Tag |")
            lines.append("|---|---|---|")
            for n in e["numbers"]:
                lines.append(f"| {_md_escape(n['name'])} | {_md_escape(n['value'])} | {n['tag']} |")
            lines.append("")

    lines.append("## Unindexed, allowed")
    lines.append("")
    lines.append(
        "Theorem-family labels/environments in the three corpora that are not (yet) "
        "index entries, with the reason each is out of scope for this wave."
    )
    lines.append("")
    lines.append("| Id | File | Reason |")
    lines.append("|---|---|---|")
    for a in sorted(index["unindexed_allow"], key=lambda a: (a["file"], a["id"])):
        lines.append(f"| `{_md_escape(a['id'])}` | `{a['file']}` | {_md_escape(a['reason'])} |")
    lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    global REPO_ROOT
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true", help="print the full inventory scanned")
    parser.add_argument("--write-md", action="store_true", help="regenerate docs/harbor-research/LIBRARY-INDEX.md")
    parser.add_argument("--check-md", action="store_true", help="fail if LIBRARY-INDEX.md is stale")
    parser.add_argument(
        "--repo-root", default=None,
        help=argparse.SUPPRESS,  # internal: lets tests point this at a fixture tree
    )
    args = parser.parse_args()

    if args.repo_root:
        REPO_ROOT = os.path.abspath(args.repo_root)

    try:
        index = load_index()
    except IndexError_ as e:
        print(f"FATAL: {e}", file=sys.stderr)
        return 1

    try:
        textbook = load_textbook()
    except (OSError, json.JSONDecodeError) as e:
        print(f"FATAL: could not read {TEXTBOOK_REL}: {e}", file=sys.stderr)
        return 1

    files = all_corpus_files()

    if args.verbose:
        print("=" * 78)
        print(f"INVENTORY: {len(index['entries'])} entries, "
              f"{len(index['unindexed_allow'])} unindexed_allow entries, "
              f"{len(files)} corpus files reachable via \\input")
        print("=" * 78)
        for e in sorted(index["entries"], key=lambda e: e["id"]):
            chs = ", ".join(c["file"] for c in e.get("chapters", [])) or "(none)"
            print(f"  {e['id']:<24} [{e['status']:<15}] standalone="
                  f"{e['standalone']['file'] if e.get('standalone') else '(none)'}  chapters={chs}")
        print()

    all_failures: list[str] = []
    checks = [
        ("(a) existence", check_existence(index)),
        ("(b) coverage", check_coverage(index, files)),
        ("(c) drift", check_drift(index)),
        ("(d) twin header", check_twin_headers(index)),
        ("(e) chapter prefix", check_chapter_prefix(index, textbook)),
    ]
    for name, failures in checks:
        print("=" * 78)
        print(f"CHECK {name}: {len(failures)} failure(s)")
        print("=" * 78)
        for f in failures:
            print(f"  {f}")
        if failures:
            print()
        all_failures.extend(failures)

    md_content = generate_markdown(index, textbook)
    md_path = abspath(MD_REL)

    if args.write_md:
        with open(md_path, "w", encoding="utf-8") as fh:
            fh.write(md_content)
        print(f"wrote {MD_REL} ({len(md_content)} bytes)")

    if args.check_md:
        on_disk = read_text(MD_REL)
        md_failures: list[str] = []
        if on_disk is None:
            md_failures.append(f"(f) {MD_REL} does not exist; run --write-md")
        elif on_disk != md_content:
            md_failures.append(
                f"(f) {MD_REL} is stale (does not match a fresh --write-md render); "
                f"run: python3 scripts/harbor-research/check_library_index.py --write-md"
            )
        print("=" * 78)
        print(f"CHECK (f) LIBRARY-INDEX.md freshness: {len(md_failures)} failure(s)")
        print("=" * 78)
        for f in md_failures:
            print(f"  {f}")
        if md_failures:
            print()
        all_failures.extend(md_failures)

    print("=" * 78)
    print(f"SUMMARY: {len(all_failures)} total failure(s) across {len(checks)} checks"
          + (" + (f) markdown freshness" if args.check_md else ""))
    print("=" * 78)

    return 1 if all_failures else 0


if __name__ == "__main__":
    sys.exit(main())
