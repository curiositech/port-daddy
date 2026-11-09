#!/usr/bin/env python3
"""check_status_consistency.py -- does a chapter's status word for an
artifact agree with the manifest's?

Report-only for now: it lists every artifact a chapter names whose printed
status word disagrees with book/corpus.json, and exits 0. --strict makes a
disagreement fail, for the day the hand-written tables are replaced by
render_status_tables.py's generated ones and the remaining prose agrees.

Which artifacts a chapter names, and what the manifest says about each, is
render_status_tables.py's business; this script imports it, so the table
generator and this check cannot read either vocabulary differently.

The Book's status word for a mention is taken from its context. In a table
row: the status markers in the row (\\Closed, \\Partial, \\Open, \\SpecOnly,
\\Verified, \\Proved, \\Unproved, \\Built, \\BuiltWeak, \\Designed, \\Vision,
\\NotGuar), or, in a row with no marker, the words discharged, verified,
proved, closed, model-checked, mechanized, retired, not in CI and
historical. In prose: only the markers in the same sentence. A mention with
no status word has nothing to disagree with and is only counted.

A word disagrees with an artifact when it claims more or less than the
manifest's state supports (current / partial / retired / historical, and
whether the model tracks shipped code):

    overclaim    a closed or verified word for an artifact that is not
                 current and CI-run; a partial or implemented word for one
                 that is retired or historical; a spec-only or specified word
                 for one that is retired or historical
    scope        a closed word for a current design-level model, whose
                 runtime the manifest does not track; a spec-only or
                 specified word for a model the manifest says tracks shipped
                 code
    underclaim   an open, unproved or proposed word for a current, CI-run
                 artifact
    retirement   "retired" or "not in CI" for an artifact CI still runs

A name that matches several manifest entries (isolation.pv is both a
current model and three historical campaign snapshots) disagrees only when
it disagrees with all of them.

It also lists the artifact-like names a chapter prints that the manifest
does not register, and the status-table rows that claim verification while
naming no artifact at all (Table 6.5's "verified as model").

Usage:
    python3 scripts/harbor-research/check_status_consistency.py
    python3 scripts/harbor-research/check_status_consistency.py --out FILE
    python3 scripts/harbor-research/check_status_consistency.py --strict
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_status_tables as rst  # noqa: E402

MARKERS = re.compile(
    r"\\(Closed|Partial|Open|SpecOnly|Verified|Proved|Unproved|BuiltWeak|Built|Designed|Vision|NotGuar"
    r"|BUILTWEAK|BUILT|DESIGNED|VISION)(?![A-Za-z@])"
)
WORDS = re.compile(
    r"(?<!not )(?<![\w\\-])(discharged|verified|proved|proven|closed|model-checked|mechani[sz]ed|retired|historical|not in CI)(?![\w-])",
    re.I,
)
QUOTED = re.compile(r"``.*?''", re.S)


def prose(context: str) -> str:
    """The words of a context: markers and quoted rules out, so \\Closed is
    not the word "closed" and ``only when verified'' claims nothing."""
    return QUOTED.sub(" ", MARKERS.sub(" ", context))

# Book word -> its class.
CLASS = {
    "Closed": "strong", "Verified": "strong", "Proved": "strong",
    "discharged": "strong", "verified": "strong", "proved": "strong", "proven": "strong",
    "closed": "strong", "model-checked": "strong", "mechanized": "strong", "mechanised": "strong",
    "Partial": "partial", "BuiltWeak": "partial", "BUILTWEAK": "partial", "Built": "partial", "BUILT": "partial",
    "SpecOnly": "spec", "Designed": "spec", "DESIGNED": "spec",
    "Open": "open", "Unproved": "open", "Vision": "open", "VISION": "open", "NotGuar": "open",
    "retired": "retired", "not in ci": "retired",
    "historical": "historical",
}


def verdict(word_class: str, artifact: rst.Artifact) -> str | None:
    """None when the word agrees with the artifact, else the disagreement."""
    state = artifact.state
    live = state in ("current", "partial")
    if word_class == "strong":
        if state != "current":
            return "overclaim"
        return "scope" if artifact.authority == "design-claim" else None
    if word_class == "partial":
        return None if live else "overclaim"
    if word_class == "spec":
        if not live:
            return "overclaim"
        return "scope" if artifact.authority == "product-runtime" else None
    if word_class == "open":
        return "underclaim" if state == "current" else None
    if word_class == "retired":
        return None if state == "retired" else "retirement"
    if word_class == "historical":
        return None if state in ("historical", "retired") else "retirement"
    return None


# A margin grade, \pdstatus{grade}{note}, grades the paragraph's mechanism;
# an artifact its note names is evidence for that mechanism, not its subject.
MARGIN_GRADE = re.compile(r"\\pdstatus\s*\\[A-Za-z]+")


def book_words(mention: rst.Mention) -> list[str]:
    context = mention.context if mention.in_table else MARGIN_GRADE.sub(" ", mention.context)
    markers = MARKERS.findall(context)
    if markers or not mention.in_table:
        return list(dict.fromkeys(markers))
    return list(dict.fromkeys(m.lower() if m.lower() == "not in ci" else m for m in WORDS.findall(prose(mention.context))))


def disagreements(named: list[rst.Mention]) -> list[tuple[rst.Mention, str, str, list[rst.Artifact]]]:
    found = []
    for mention in named:
        for word in book_words(mention):
            word_class = CLASS.get(word, CLASS.get(word.lower()))
            if not word_class:
                continue
            verdicts = [verdict(word_class, a) for a in mention.candidates]
            if all(verdicts):
                found.append((mention, word, verdicts[0], mention.candidates))
    return found


def verification_without_artifact(units: list[rst.Unit], named: list[rst.Mention]) -> list[tuple[rst.Unit, Path, int, str]]:
    """Status-table rows (they carry a marker other than an open one) that
    claim verification in words but name no artifact at all."""
    claimed = {(m.file, m.line) for m in named}
    rows = []
    for unit in units:
        for path in unit.files:
            raw = path.read_text(encoding="utf-8")
            text, origin = rst.unwrap_markup(raw)
            for start, end, _ in rst.contexts(text):
                row = text[start:end]
                classes = {CLASS[m] for m in MARKERS.findall(row)}
                if ("\\caption" in row or not classes or classes == {"open"}
                        or rst.TOKEN.search(row) or rst.HARNESS.search(row)):
                    continue
                strong = [w for w in WORDS.findall(prose(row)) if CLASS.get(w.lower()) == "strong"]
                if not strong:
                    continue
                at = next((k for k in range(start, end) if not row[k - start].isspace()), start)
                line = raw.count("\n", 0, origin[at]) + 1 if at < len(origin) else 0
                if (path, line) in claimed:
                    continue
                rows.append((unit, path, line, re.sub(r"\s+", " ", row).strip()))
    return rows


def unit_name(unit: rst.Unit) -> str:
    return f"Ch. {unit.number} {unit.prefix}" if unit.number is not None else unit.title


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(rst.REPO_ROOT))
    except ValueError:
        return str(path)


def excerpt(text: str, limit: int = 220) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def report() -> tuple[str, int]:
    artifacts = rst.load_manifest()
    units = rst.load_units()
    named, unregistered = rst.mentions(units, artifacts)
    found = disagreements(named)
    bare = verification_without_artifact(units, named)
    try:
        commit = subprocess.run(["git", "rev-parse", "--short=9", "HEAD"], cwd=rst.REPO_ROOT,
                                capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "unknown"

    out = [
        "Status words in the Book against the proof-estate manifest (book/corpus.json)",
        f"scripts/harbor-research/check_status_consistency.py at {commit}; report-only",
        "",
        "Rules: see the script's docstring. The manifest's state, in the Book's markers:",
        "current + CI + shipped code = \\Closed; current + CI + design-level model = \\SpecOnly;",
        "partial = \\Partial; retired from CI or historical = \\Open.",
        "",
        f"== Disagreements: {len(found)} (in {len({(m.file, m.line) for m, *_ in found})} places)",
    ]
    by_kind = Counter(kind for _, _, kind, _ in found)
    out.append("   " + ", ".join(f"{k} {by_kind[k]}" for k in ("overclaim", "scope", "underclaim", "retirement") if by_kind[k]))
    out.append("")
    for mention, word, kind, candidates in found:
        shown = f"\\{word}" if word[0].isupper() else f'"{word}"'
        out.append(f"{rel(mention.file)}:{mention.line} [{unit_name(mention.unit)}] {mention.token}")
        out.append(f"    {kind}: the Book says {shown}; the manifest says")
        for artifact in candidates:
            out.append(f"      {artifact.describe()} -> \\{artifact.marker}")
        out.append(f"    {'row' if mention.in_table else 'sentence'}: {excerpt(mention.context)}")
        out.append("")

    out.append(f"== Status-table rows that claim verification and name no artifact: {len(bare)}")
    out.append("")
    for unit, path, line, row in bare:
        out.append(f"{rel(path)}:{line} [{unit_name(unit)}] {excerpt(row)}")
    out.append("")

    grouped: dict[tuple[str, str], list[rst.Mention]] = {}
    for mention in unregistered:
        grouped.setdefault((unit_name(mention.unit), mention.token), []).append(mention)
    out.append(f"== Named but not registered in the manifest: {len(grouped)} name(s)")
    out.append("")
    for (unit, token), group in sorted(grouped.items()):
        first = group[0]
        more = f" (+{len(group) - 1} more)" if len(group) > 1 else ""
        out.append(f"{rel(first.file)}:{first.line} [{unit}] {token}{more}")
    out.append("")

    out.append("== Per chapter: manifest artifacts named, mentions, mentions with a status word, disagreements")
    for unit in units:
        mine = [m for m in named if m.unit is unit]
        worded = [m for m in mine if book_words(m)]
        disagree = [f for f in found if f[0].unit is unit]
        out.append(f"   {unit_name(unit):<20} {len(rst.artifacts_named(unit, named)):>3} artifacts, "
                   f"{len(mine):>3} mentions, {len(worded):>3} with a status word, {len(disagree):>3} disagreements")
    return "\n".join(out) + "\n", len(found)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, help="also write the report here")
    parser.add_argument("--strict", action="store_true", help="exit 1 when any status word disagrees")
    args = parser.parse_args(argv)
    text, count = report()
    sys.stdout.write(text)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    return 1 if args.strict and count else 0


if __name__ == "__main__":
    sys.exit(main())
