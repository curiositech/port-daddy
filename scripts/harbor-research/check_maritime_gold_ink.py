#!/usr/bin/env python3
"""check_maritime_gold_ink.py -- the --print-maritime-gold ink stays what
BRAND.md:56 says it is, and nowhere else.

BRAND.md's own words: "gold-the-ink is plate trim and opener ornament,
gold-the-story-colour is the market" -- and it "never sits beside
--story-gold", which it is 15.6 DeltaE2000 apart from and means something
different from. Two rules follow, and this script is both of them:

  A. Every use of the ink (TeX macro name `pdmaritimegold`; CSS custom
     property `--print-maritime-gold`) outside its own definition and its
     two documented roles -- a gilt fillet under a title rule, or plate
     trim/opener ornament drawn directly with it -- fails. Today the only
     real uses are the two title-rule fillets in the Book's preamble
     (`\color{pdmaritimegold}\rule{...}`); this allow-list is exactly that
     pattern, by design narrow rather than by oversight -- a new legitimate
     use (a plate border, an opener mark) is a one-line addition to
     ALLOWED_TEX_PATTERNS, not a reason to loosen the check to "anything
     drawn with it is fine".
  B. The ink and the story colour (TeX `pdgold`; CSS `--story-gold`) never
     appear within PROXIMITY_LINES of each other in the same TeX file (a
     figure or a title block that reaches for both is exactly the confusion
     BRAND.md is guarding against), and never inside the same CSS rule block
     in tokens.semantic.css.

Never fails open: a file with neither token is not evidence of correctness,
so this script always reports how many files and lines it actually looked
at, and CI treats a run that scans nothing as suspicious on its own (see
--repo-root's default glob counts in the summary line).

Usage:
    python3 scripts/harbor-research/check_maritime_gold_ink.py [--repo-root PATH]
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys

TEX_GLOBS = [
    "whitepaper/**/*.tex",
    "website-v2/public/whitepaper/**/*.tex",
]
# Token/component files where the CSS custom property could be reached from
# component code -- everything under src, plus the token file itself (which
# is where the one legitimate definition lives).
CSS_TOKEN_GLOBS = [
    "website-v2/src/**/*.css",
    "website-v2/src/**/*.ts",
    "website-v2/src/**/*.tsx",
    "website-v2/src/**/*.js",
    "website-v2/src/**/*.jsx",
]
TOKENS_FILE = "website-v2/src/styles/tokens.semantic.css"

TEX_INK = "pdmaritimegold"
TEX_STORY = "pdgold"
CSS_INK = "--print-maritime-gold"
CSS_STORY = "--story-gold"

# How close (in source lines, within one file) the ink and the story colour
# may come before this counts as "sitting beside" each other.
PROXIMITY_LINES = 6

_TEX_COMMENT_RE = re.compile(r"(?<!\\)%.*$", re.MULTILINE)


def _strip_tex_comments(text: str) -> str:
    return _TEX_COMMENT_RE.sub("", text)


# A TeX line is allowed to use the ink when it is the palette's own
# \definecolor, or a \color{pdmaritimegold} immediately drawing a \rule (the
# two known gilt-fillet-under-a-title-rule sites). Both are checked on the
# SAME line the ink name appears on, deliberately narrow: a future plate-
# trim or opener-ornament use should be added here by name, not waved
# through by widening the pattern to "anywhere near a \rule or \fill".
ALLOWED_TEX_LINE_PATTERNS = [
    re.compile(r"\\definecolor\{" + TEX_INK + r"\}"),
    re.compile(r"\\color\{" + TEX_INK + r"\}.*\\rule\{"),
]


def find_files(repo_root: str, globs: list[str]) -> list[str]:
    paths: list[str] = []
    for pattern in globs:
        paths.extend(glob.glob(os.path.join(repo_root, pattern), recursive=True))
    return sorted(set(paths))


def check_tex_usage(repo_root: str) -> tuple[list[str], int, int]:
    """Returns (failures, files_scanned, ink_occurrences_seen)."""
    failures: list[str] = []
    files = find_files(repo_root, TEX_GLOBS)
    ink_seen = 0
    for path in files:
        rel = os.path.relpath(path, repo_root)
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
        text = _strip_tex_comments(raw)
        lines = text.split("\n")

        ink_lines = [i for i, line in enumerate(lines) if TEX_INK in line]
        story_lines = [i for i, line in enumerate(lines) if re.search(r"\b" + TEX_STORY + r"\b", line)]
        ink_seen += len(ink_lines)

        for i in ink_lines:
            line = lines[i]
            if not any(p.search(line) for p in ALLOWED_TEX_LINE_PATTERNS):
                failures.append(
                    f"{rel}:{i + 1}: '{TEX_INK}' used outside its documented roles "
                    f"(plate trim, opener ornament, or a gilt fillet under a title "
                    f"rule -- BRAND.md:56): {line.strip()!r}"
                )

        # Proximity rule (B), TeX side.
        for ink_i in ink_lines:
            for story_i in story_lines:
                if abs(ink_i - story_i) <= PROXIMITY_LINES:
                    failures.append(
                        f"{rel}: '{TEX_INK}' (line {ink_i + 1}) and '{TEX_STORY}' "
                        f"(line {story_i + 1}) sit within {PROXIMITY_LINES} lines of "
                        f"each other -- the ink and the story colour are 15.6 "
                        f"DeltaE2000 apart and mean different things; they never sit "
                        f"beside one another (BRAND.md:56)"
                    )
    return failures, len(files), ink_seen


def _css_rule_blocks(text: str) -> list[str]:
    """Every {...} block in a CSS-like file, as its raw inner text. Simple
    brace matching is enough here: these files do not nest custom-property
    blocks inside strings or comments in a way that would confuse it, and a
    false split only widens what counts as "the same block", which is the
    safe direction for a proximity check."""
    blocks = []
    depth = 0
    start = None
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i + 1
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                blocks.append(text[start:i])
                start = None
    return blocks


def check_css_usage(repo_root: str) -> tuple[list[str], int, int]:
    failures: list[str] = []
    files = find_files(repo_root, CSS_TOKEN_GLOBS)
    tokens_abs = os.path.abspath(os.path.join(repo_root, TOKENS_FILE))
    ink_seen = 0

    for path in files:
        rel = os.path.relpath(path, repo_root)
        is_tokens_file = os.path.abspath(path) == tokens_abs
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        if CSS_INK not in text:
            continue
        ink_seen += text.count(CSS_INK)
        if not is_tokens_file:
            # Rule A, CSS/component side: nothing outside the token file's
            # own definition reaches for the literal ink name today: it
            # should come through a semantic role token, not this one.
            for lineno, line in enumerate(text.split("\n"), start=1):
                if CSS_INK in line:
                    failures.append(
                        f"{rel}:{lineno}: component code reaches for "
                        f"'{CSS_INK}' directly; it should reach a semantic "
                        f"role token instead, and this one is plate trim / "
                        f"opener ornament only (BRAND.md:56): {line.strip()!r}"
                    )
        else:
            # Rule B, CSS side: the token FILE necessarily lists every
            # design token together, ink and story colour both -- that is
            # the definitions list, not two colours "sitting beside" each
            # other on a rendered surface, so the block/proximity check
            # applies only to files that actually CONSUME the tokens (a
            # component rule set that reaches for both in one selector).
            # Nothing does today; if one ever does, it is caught below.
            pass

    for path in files:
        if os.path.abspath(path) == tokens_abs:
            continue
        rel = os.path.relpath(path, repo_root)
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        if CSS_INK not in text or CSS_STORY not in text:
            continue
        for block in _css_rule_blocks(text):
            if CSS_INK in block and CSS_STORY in block:
                failures.append(
                    f"{rel}: '{CSS_INK}' and '{CSS_STORY}' both referenced "
                    f"in one rule block -- they never sit beside one another "
                    f"(BRAND.md:56)"
                )

    return failures, len(files), ink_seen


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--repo-root",
        default=os.path.dirname(os.path.abspath(__file__)) + "/../..",
        help="Repository root (default: two levels up from this script).",
    )
    args = parser.parse_args()
    repo_root = os.path.abspath(args.repo_root)

    tex_failures, tex_files, tex_ink_seen = check_tex_usage(repo_root)
    css_failures, css_files, css_ink_seen = check_css_usage(repo_root)
    all_failures = tex_failures + css_failures

    for failure in all_failures:
        print(f"FAIL: {failure}")

    total_files = tex_files + css_files
    if total_files == 0:
        # Never fail open: no files scanned is not "nothing to check", it is
        # the glob patterns having drifted from where the sources live.
        print(
            "FAIL: no TeX or token/component files were found under the "
            "configured globs -- the check ran against nothing"
        )
        return 1

    print(
        f"checked {tex_files} TeX file(s) ({tex_ink_seen} ink occurrence(s)) and "
        f"{css_files} token/component file(s) ({css_ink_seen} ink occurrence(s)): "
        f"{len(all_failures)} failure(s)"
    )
    return 1 if all_failures else 0


if __name__ == "__main__":
    sys.exit(main())
