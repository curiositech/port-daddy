#!/usr/bin/env python3
r"""check_figcheck_corpus.py -- the figure-QA record set and the live figure
corpus must name exactly the same fragments, in both directions.

Stdlib-only, offline: it reads the chapter sources, the two chapter figure
directories, and the committed figcheck/*.json records. No TeX, no PDF.

Why this exists
---------------
`render_figure_audit.py --check` proves the digest, the failures doc and
blockers.json are a fresh render OF the records. `check_figure_register.py`
proves the register's rows are well-formed. Neither asks the prior question:
are those records about figures that still ship? On 2026-09 they were not --
79 records described a corpus of 56 drawings, overlapping on 52. Twenty-seven
records reported geometry for fragments deleted or renamed waves earlier, and
four live drawings had never been checked at all. Every downstream artefact
was a faithful, fresh render of a corpus that no longer existed.

That is the defect class this file closes: validation that checks shape but
not existence. A digest regenerated from stale records is still stale, and
nothing in the chain noticed, because nothing in the chain compared the
record set with the corpus.

What the live figure corpus is
------------------------------
Derived mechanically, never hand-maintained, in two conjuncts:

  REACHED   The Book's eight chapter sources are read from the `source` field
            of every entry in whitepaper/textbook.json -- the same convention
            skills/tufte-evidence-design/scripts/margin_lint.py and
            skills/textbook-craft/scripts/chapter_lint.py both use, so a
            ninth chapter joins the corpus the day textbook.json gains one.
            A fragment is REACHED when at least one of those sources carries
            an `\input{figures/<stem>}` line that resolves to a file in that
            chapter's own figures/ directory.

  DRAWS     The fragment's source contains a `\begin{tikzpicture}`.

Both conjuncts are properties of the files themselves, so there is no skip
list to maintain and no name to special-case. They are what separates the
drawings from the other things that live in figures/:

  * figures/pd-*.tex are shared preamble includes -- the palette, the figure
    language, the hyperlink setup, the pedagogy environments, the textbook
    map. Every chapter `\input`s all five, and they draw nothing; they define
    macros. DRAWS excludes them.
  * figures/session-*.tex are recorded terminal transcripts set as verbatim
    blocks, and figures/tab-*.tex are tabulars. Both are `\input` by a
    chapter and neither opens a tikzpicture, so there is no drawn canvas for
    figcheck's T1-T8 geometry checks to measure. DRAWS excludes them too.
  * A fragment on disk that no chapter `\input`s is dead weight -- it ships
    to nobody, so a geometry report on it measures nothing that prints.
    REACHED excludes it, and --orphans lists exactly those files so the
    exclusion is on the record rather than silent.

Usage:
    python3 scripts/harbor-research/check_figcheck_corpus.py
    python3 scripts/harbor-research/check_figcheck_corpus.py --verbose
    python3 scripts/harbor-research/check_figcheck_corpus.py --list
    python3 scripts/harbor-research/check_figcheck_corpus.py --orphans
    python3 scripts/harbor-research/check_figcheck_corpus.py --json

Exit status:
    0  every live fragment has a figcheck record and every record names a
       live fragment.
    1  they disagree in either direction; every offending name is printed.
    2  the corpus could not be derived (textbook.json unreadable, a chapter
       source missing).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEXTBOOK_REL = "whitepaper/textbook.json"
FIGCHECK_REL = "docs/harbor-research/exposition/figures/figcheck"

# Every figures/ directory a chapter source can `\input` from. Derived from
# the chapter list rather than hard-coded for membership; this tuple only
# bounds where --orphans looks for files nothing reaches.
FIGURE_DIRS = (
    "whitepaper/figures",
    "website-v2/public/whitepaper/figures",
)

INPUT_RE = re.compile(r"\\input\{figures/([A-Za-z0-9._-]+?)(?:\.tex)?\}")
DRAWS_TOKEN = r"\begin{tikzpicture}"


def chapter_sources(repo_root: str) -> list[str]:
    """The Book's chapter list, straight from the `source` field of every
    entry in whitepaper/textbook.json. Same shape as margin_lint.py's and
    chapter_lint.py's functions of the same purpose, so no chapter path is
    ever written down twice."""
    path = os.path.join(repo_root, TEXTBOOK_REL)
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return [ch["source"] for ch in data["chapters"]]


def live_corpus(repo_root: str) -> dict[str, dict]:
    """{stem: {"path": repo-relative .tex path, "chapters": [source, ...]}}
    for every fragment that is both REACHED and DRAWS (see the module
    docstring). Raises on a chapter source that does not exist -- a corpus
    silently derived from seven of eight chapters is worse than no corpus."""
    corpus: dict[str, dict] = {}
    for source in chapter_sources(repo_root):
        abs_source = os.path.join(repo_root, source)
        if not os.path.isfile(abs_source):
            raise FileNotFoundError(f"chapter source named in {TEXTBOOK_REL} does not exist: {source}")
        with open(abs_source, encoding="utf-8") as fh:
            text = fh.read()
        fig_dir = os.path.join(os.path.dirname(abs_source), "figures")
        for stem in sorted(set(INPUT_RE.findall(text))):
            abs_frag = os.path.join(fig_dir, stem + ".tex")
            if not os.path.isfile(abs_frag):
                # An \input that resolves nowhere is the chapter's problem, and
                # check_tex_environments.py / the build catch it. Not a corpus
                # member either way.
                continue
            with open(abs_frag, encoding="utf-8") as fh:
                if DRAWS_TOKEN not in fh.read():
                    continue
            rel_frag = os.path.relpath(abs_frag, repo_root)
            entry = corpus.setdefault(stem, {"path": rel_frag, "chapters": []})
            entry["chapters"].append(source)
    return corpus


def orphan_fragments(repo_root: str, corpus: dict[str, dict]) -> list[str]:
    """Repo-relative paths of .tex files in a chapter figures/ directory that
    no chapter `\\input`s -- dead weight, reported and never checked."""
    reached = set()
    for source in chapter_sources(repo_root):
        abs_source = os.path.join(repo_root, source)
        if not os.path.isfile(abs_source):
            continue
        with open(abs_source, encoding="utf-8") as fh:
            reached.update(INPUT_RE.findall(fh.read()))
    orphans = []
    for rel_dir in FIGURE_DIRS:
        abs_dir = os.path.join(repo_root, rel_dir)
        if not os.path.isdir(abs_dir):
            continue
        for name in sorted(os.listdir(abs_dir)):
            if not name.endswith(".tex"):
                continue
            stem = name[: -len(".tex")]
            if stem in reached or stem in corpus:
                continue
            orphans.append(os.path.join(rel_dir, name))
    return sorted(orphans)


def figcheck_records(repo_root: str) -> dict[str, str]:
    """{stem: repo-relative record path} for every committed figcheck JSON."""
    abs_dir = os.path.join(repo_root, FIGCHECK_REL)
    if not os.path.isdir(abs_dir):
        raise FileNotFoundError(f"{FIGCHECK_REL} does not exist")
    records = {}
    for name in sorted(os.listdir(abs_dir)):
        if not name.endswith(".json"):
            continue
        records[name[: -len(".json")]] = os.path.join(FIGCHECK_REL, name)
    return records


def compare(corpus: dict[str, dict], records: dict[str, str]) -> tuple[list[str], list[str]]:
    """(records_without_fragment, fragments_without_record), both sorted."""
    return (
        sorted(set(records) - set(corpus)),
        sorted(set(corpus) - set(records)),
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="The figcheck record set and the live figure corpus name the same fragments.",
    )
    ap.add_argument("--repo-root", default=REPO_ROOT,
                    help="repository root (default: inferred from this script's location)")
    ap.add_argument("--verbose", action="store_true",
                    help="also print the corpus size and the orphan count on success")
    ap.add_argument("--list", action="store_true",
                    help="print the derived live corpus (stem, path, chapter count) and exit 0")
    ap.add_argument("--orphans", action="store_true",
                    help="print the fragments on disk that no chapter \\input's and exit 0")
    ap.add_argument("--json", action="store_true",
                    help="emit the comparison as JSON instead of text")
    args = ap.parse_args(argv)

    repo_root = os.path.abspath(args.repo_root)
    try:
        corpus = live_corpus(repo_root)
    except Exception as exc:  # noqa: BLE001
        print(f"check_figcheck_corpus.py: could not derive the live figure corpus: {exc}", file=sys.stderr)
        return 2

    if args.list:
        for stem in sorted(corpus):
            entry = corpus[stem]
            print(f"{stem}\t{entry['path']}\t{len(entry['chapters'])}")
        return 0

    if args.orphans:
        for path in orphan_fragments(repo_root, corpus):
            print(path)
        return 0

    try:
        records = figcheck_records(repo_root)
    except Exception as exc:  # noqa: BLE001
        print(f"check_figcheck_corpus.py: could not read the figcheck records: {exc}", file=sys.stderr)
        return 2

    stale, uncovered = compare(corpus, records)

    if args.json:
        print(json.dumps({
            "corpus_size": len(corpus),
            "record_count": len(records),
            "records_without_fragment": stale,
            "fragments_without_record": uncovered,
            "orphan_fragments": orphan_fragments(repo_root, corpus),
        }, indent=2, sort_keys=True))
        return 1 if (stale or uncovered) else 0

    if not stale and not uncovered:
        print(f"OK: {len(corpus)} live figure fragments, {len(records)} figcheck records, same names.")
        if args.verbose:
            orphans = orphan_fragments(repo_root, corpus)
            print(f"  corpus derived from {len(chapter_sources(repo_root))} chapter sources in {TEXTBOOK_REL}")
            print(f"  {len(orphans)} fragment(s) on disk that no chapter \\input's (excluded, not checked):")
            for path in orphans:
                print(f"    {path}")
        return 0

    if stale:
        print(f"{len(stale)} figcheck record(s) describe a fragment that is not in the live corpus:")
        for stem in stale:
            print(f"  {stem}  ({records[stem]})")
        print("  Either the fragment came back, or the record outlived it: delete the record.")
    if uncovered:
        print(f"{len(uncovered)} live fragment(s) have no figcheck record:")
        for stem in uncovered:
            print(f"  {stem}  ({corpus[stem]['path']})")
        print("  Compile each under the chapter preamble and write its record:")
        print("    skills/harbor-chartwork/scripts/compile_fragment.sh FRAGMENT --preamble chapter --out DIR")
        print("    python3 skills/harbor-chartwork/scripts/figcheck.py DIR/STEM.pdf --json "
              f"{FIGCHECK_REL}/STEM.json")
    print(f"\nlive corpus: {len(corpus)} fragment(s); figcheck records: {len(records)}.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
