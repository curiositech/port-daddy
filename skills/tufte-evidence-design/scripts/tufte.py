#!/usr/bin/env python3
"""tufte.py -- one entry point for this skill's scripts and reference lookups.

Subcommands:

  audit <png...> [--json] [--strict]
      Runs ink_audit.py's heuristic ink/edge/chartjunk-proxy audit over one or
      more PNG files (imported, not duplicated). --strict makes the command
      exit non-zero if any file raised a heuristic flag; without it, the
      command's exit code reflects only whether every file could be read and
      audited (ink_audit's own flags are advisory, never a pass/fail verdict
      on their own -- see ink_audit.py's docstring).

  margin-lint <tex...> [--json]
      Delegates to margin_lint.py (this skill's mechanical margin-apparatus
      checker). With no files, margin_lint.py's own default applies: the
      Book's eight chapter sources, read from whitepaper/textbook.json.

  checklist <kind>
      Prints one checklist from SKILL.md's "## Checklists" section, matched
      by a case-insensitive, hyphen-or-space-insensitive slug of its "### "
      heading (e.g. "sparklines", "data-ink", "margin-apparatus"). The kinds
      and their prose are READ from SKILL.md at run time, not hardcoded here
      -- run `tufte.py checklist` with no argument (or an unmatched one) to
      list the kinds SKILL.md currently defines.

  decision-tree
      Prints the mermaid flowchart from SKILL.md's "## Core Process: Evidence
      Form Decision Tree" section as plain text, read from SKILL.md at run
      time (not hardcoded here), including its "limit:" pointer lines into
      references/critiques-and-limits.md.

Usage:
    python3 tufte.py audit figure.png [figure2.png ...] [--json] [--strict]
    python3 tufte.py margin-lint [chapter.tex ...] [--json]
    python3 tufte.py checklist sparklines
    python3 tufte.py decision-tree

Exit status: each subcommand's own (see above); 2 on a usage error (unknown
subcommand, missing required argument, or SKILL.md/ink_audit.py/margin_lint.py
could not be read).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILL_MD = SKILL_ROOT / "SKILL.md"


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _slugify(title: str) -> str:
    title = re.sub(r'\(.*?\)', '', title)  # drop parenthetical asides
    title = title.lower()
    title = re.sub(r'[^a-z0-9]+', '-', title).strip('-')
    return title


# --------------------------------------------------------------------------- #
# audit
# --------------------------------------------------------------------------- #

def cmd_audit(args) -> int:
    ink_audit = _load_module(SKILL_ROOT / "scripts" / "ink_audit.py", "ink_audit")
    background_override = ink_audit.parse_background_arg(args.background)

    results = []
    any_error = False
    any_flagged = False
    for image_path in args.images:
        path = Path(image_path)
        entry = {"file": str(path)}
        if not path.exists():
            entry["error"] = "no such file"
            any_error = True
            results.append(entry)
            continue
        try:
            img = ink_audit.load_image(path)
            result = ink_audit.audit(img, background_override=background_override)
            entry.update(result)
            has_real_flag = not (
                len(result["flags"]) == 1 and result["flags"][0].startswith("No heuristic flags raised")
            )
            if has_real_flag:
                any_flagged = True
        except Exception as exc:  # noqa: BLE001 - surface any decode failure plainly
            entry["error"] = str(exc)
            any_error = True
        results.append(entry)

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        for entry in results:
            if "error" in entry:
                print(f"{entry['file']}: error: {entry['error']}")
                continue
            print(ink_audit.format_human(entry))
            print(f"({entry['file']})")
            print()

    if any_error:
        return 1
    if args.strict and any_flagged:
        return 1
    return 0


# --------------------------------------------------------------------------- #
# margin-lint
# --------------------------------------------------------------------------- #

def cmd_margin_lint(args) -> int:
    margin_lint = _load_module(SKILL_ROOT / "scripts" / "margin_lint.py", "margin_lint")
    argv = list(args.files)
    if args.json:
        argv.append("--json")
    if args.repo_root:
        argv += ["--repo-root", args.repo_root]
    return margin_lint.main(argv)


# --------------------------------------------------------------------------- #
# checklist
# --------------------------------------------------------------------------- #

def _parse_checklists(skill_md_text: str) -> dict:
    """Return {slug: (title, body_text)} for every "### " subsection under
    SKILL.md's "## Checklists" heading. Read at run time so the kinds and
    their prose always match whatever SKILL.md currently says -- this
    function hardcodes no checklist text, only the parsing of it."""
    m = re.search(r'^## Checklists\s*$(.*?)(?=^## )', skill_md_text, re.MULTILINE | re.DOTALL)
    if not m:
        return {}
    section = m.group(1)
    out = {}
    for sm in re.finditer(r'^### (.+?)\s*$(.*?)(?=^### |\Z)', section, re.MULTILINE | re.DOTALL):
        title = sm.group(1).strip()
        body = sm.group(2).strip('\n')
        out[_slugify(title)] = (title, body)
    return out


def cmd_checklist(args) -> int:
    text = SKILL_MD.read_text(encoding="utf-8")
    checklists = _parse_checklists(text)
    if not checklists:
        print("tufte.py: could not find a '## Checklists' section in SKILL.md", file=sys.stderr)
        return 2

    if not args.kind:
        print("Available checklist kinds (from SKILL.md):")
        for slug, (title, _body) in checklists.items():
            print(f"  {slug:<20} {title}")
        return 0

    query = _slugify(args.kind)
    # Exact slug match first, then substring match (so "sparkline" finds
    # "sparklines", "margin" finds "margin-apparatus").
    match = checklists.get(query)
    if match is None:
        candidates = [k for k in checklists if query in k or k in query]
        if len(candidates) == 1:
            match = checklists[candidates[0]]
        elif len(candidates) > 1:
            print(f"tufte.py: '{args.kind}' matches more than one checklist: {', '.join(candidates)}", file=sys.stderr)
            return 2

    if match is None:
        print(f"tufte.py: no checklist matches '{args.kind}'. Available kinds:", file=sys.stderr)
        for slug in checklists:
            print(f"  {slug}", file=sys.stderr)
        return 2

    title, body = match
    print(f"# {title}\n")
    print(body)
    return 0


# --------------------------------------------------------------------------- #
# decision-tree
# --------------------------------------------------------------------------- #

def cmd_decision_tree(args) -> int:
    text = SKILL_MD.read_text(encoding="utf-8")
    m = re.search(
        r'^## Core Process: Evidence Form Decision Tree\s*$.*?```mermaid\n(.*?)```',
        text, re.MULTILINE | re.DOTALL,
    )
    if not m:
        print("tufte.py: could not find the decision tree's mermaid block in SKILL.md", file=sys.stderr)
        return 2
    print(m.group(1).rstrip('\n'))
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tufte.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_audit = sub.add_parser("audit", help="run ink_audit.py over one or more PNGs")
    p_audit.add_argument("images", nargs="+")
    p_audit.add_argument("--json", action="store_true")
    p_audit.add_argument("--strict", action="store_true", help="exit non-zero if any file raises a heuristic flag")
    p_audit.add_argument("--background", default="auto", help="'auto' (default), 'white', or 'R,G,B' -- applied to every file")
    p_audit.set_defaults(func=cmd_audit)

    p_margin = sub.add_parser("margin-lint", help="delegate to margin_lint.py")
    p_margin.add_argument("files", nargs="*", help="chapter .tex files; default: the eight Book chapters")
    p_margin.add_argument("--json", action="store_true")
    p_margin.add_argument("--repo-root", default=None)
    p_margin.set_defaults(func=cmd_margin_lint)

    p_checklist = sub.add_parser("checklist", help="print one SKILL.md checklist by kind")
    p_checklist.add_argument("kind", nargs="?", default=None, help="e.g. sparklines, data-ink, margin-apparatus; omit to list kinds")
    p_checklist.set_defaults(func=cmd_checklist)

    p_tree = sub.add_parser("decision-tree", help="print SKILL.md's evidence-form decision tree")
    p_tree.set_defaults(func=cmd_decision_tree)

    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
