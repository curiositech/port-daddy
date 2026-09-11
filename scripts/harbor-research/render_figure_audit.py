#!/usr/bin/env python3
"""render_figure_audit.py -- regenerates FIGURE-AUDIT-DIGEST.md,
FIGURE-AUDIT-FAILURES.md, and blockers.json from the committed
figcheck/*.json records under docs/harbor-research/exposition/figures/.

Stdlib-only, deterministic, offline: it reads only what is already on disk
(no TeX, no PDF rendering) and sorts every listing by fragment name so two
runs on the same inputs produce byte-identical output.

Born from the PR #10069 review: the Wave 11 audit digest and failures doc
were typed up by hand from a manual figcheck run; nothing regenerated them
from the JSON records that are the actual source of truth, so they could
silently drift the moment a fragment was re-checked.

What each output is:
  FIGURE-AUDIT-DIGEST.md    One row per figcheck/*.json record: fragment,
                            its home chapter, pass/fail, and its failed/
                            warned check codes. Totals at the foot.
  FIGURE-AUDIT-FAILURES.md  One section per record whose result is "fail",
                            with each failed check's finding count and its
                            first (deterministic) finding message.
  blockers.json             One entry per record with a T1-T5 (mechanical,
                            release-blocking) failure: id, fragment path (if
                            still on disk), chapter, checks failed, first
                            seen (the fragment's earliest git log date),
                            and a waiver (null, or {reason, expires} --
                            seeded only for a fragment FIGURE-TRIAGE.md
                            already disposes as `delete` or `table`).

A fragment's home chapter comes from a static filename-prefix table (see
PREFIX_TO_CHAPTER / STEM_OVERRIDES below), not from FIGURE-REGISTER.md or
FIGURE-TRIAGE.md -- this script must stay generatable even if those two
files are themselves broken, so it does not depend on them parsing cleanly.
FIGURE-TRIAGE.md is read only for the one thing blockers.json needs from it
(the disposition used to seed a waiver), tolerantly: a fragment it cannot
find there simply gets no waiver, which is the safe default.

Usage:
    python3 scripts/harbor-research/render_figure_audit.py --check
    python3 scripts/harbor-research/render_figure_audit.py --write

Exit status: --check exits 1 if either Markdown file or blockers.json is
stale (does not match a fresh render); --write always writes and exits 0.
Neither flag given: renders to stdout (digest, then failures, then
blockers.json) and exits 0. --check and --write may be combined.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FIGURES_DIR = "docs/harbor-research/exposition/figures"
FIGCHECK_DIR = f"{FIGURES_DIR}/figcheck"
DIGEST_REL = f"{FIGURES_DIR}/FIGURE-AUDIT-DIGEST.md"
FAILURES_REL = f"{FIGURES_DIR}/FIGURE-AUDIT-FAILURES.md"
BLOCKERS_REL = f"{FIGURES_DIR}/blockers.json"
TRIAGE_REL = f"{FIGURES_DIR}/FIGURE-TRIAGE.md"

FIGURE_DIRS = (
    "whitepaper/figures",
    "website-v2/public/whitepaper/figures",
    "docs/harbor-research/figures",
)

T1_T5 = ("T1", "T2", "T3", "T4", "T5")
ALL_CHECKS = ("T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8")

# Home chapter by filename prefix -- longest prefix wins, so "fig-fh-" (8)
# is tried before a hypothetical shorter clash. Shared figures (drawn once,
# cross-referenced from a second chapter -- see FIGURE-TRIAGE.md's "Shared
# figures" note) are homed at the chapter that draws them.
PREFIX_TO_CHAPTER = (
    ("fig-swk-", 1),
    ("fig-anchor-", 2),
    ("fig-sealed-", 3),
    ("legible-swarm-", 4),
    ("fig-stp-", 5),
    ("fig-he-", 6),
    ("fig-bonded-", 7),
    ("fig-fh-", 8),
)
# Fragments with no chapter-coded prefix, or whose prefix would guess the
# wrong home for a shared figure.
STEM_OVERRIDES = {
    "fig-governance-flow": 7,
    "fig-sybil-inline": 7,
    "fig-magic-link-inline": 7,
    "fig-worked-example": 7,
    "fig-auction-inline": 6,      # drawn for ch6, shared with 7.4
    "fig-cartel-game-inline": 6,  # drawn for ch6, shared with 7.6
}

WAIVER_DISPOSITIONS = {"delete", "table"}
WAIVER_REASON = "retired by triage"
WAIVER_EXPIRES = "2026-10-31"
# A second waiver class, and the distinction is the whole point. A figure the
# triage marked `delete` or `table` is leaving the Book, so its mechanical
# failure will never be fixed and must not block: that is WAIVER_DISPOSITIONS
# above. A figure marked `redraw` or `restyle` is staying, and its failure is a
# real outstanding defect -- but one the triage has already judged and
# scheduled, so it is a backlog rather than news. It gets a waiver that says
# so, on the same expiry, and goes red again if the redraw has not happened.
# `keep` gets nothing: a figure the triage passed on the rubric and the machine
# fails on is a contradiction between two judgements, and somebody should look
# at it rather than wave it through.
BACKLOG_DISPOSITIONS = {"redraw", "restyle", "keep+note"}
BACKLOG_REASON = (
    "condemned by Wave 11 triage and scheduled for redraw; the mechanical "
    "failure is the condition the redraw exists to end"
)

TRIAGE_ROW_RE = re.compile(r"^\|\s*(\d+\.\d+|add)\s*\|")
SHARED_SUFFIX_RE = re.compile(r"\s*\(shared with[^)]*\)\s*$")


def abspath(rel_path: str) -> str:
    return os.path.join(REPO_ROOT, rel_path)


def split_table_row(line: str) -> list[str]:
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|"):
        inner = inner[:-1]
    placeholder = "\x00"
    protected = inner.replace("\\|", placeholder)
    return [c.replace(placeholder, "\\|").strip() for c in protected.split("|")]


def chapter_for_stem(stem: str) -> int | None:
    if stem in STEM_OVERRIDES:
        return STEM_OVERRIDES[stem]
    for prefix, chapter in PREFIX_TO_CHAPTER:
        if stem.startswith(prefix):
            return chapter
    return None


def find_fragment_path(stem: str) -> str | None:
    for d in FIGURE_DIRS:
        candidate = os.path.join(d, stem + ".tex")
        if os.path.isfile(abspath(candidate)):
            return candidate
    return None


def load_figcheck_records() -> list[tuple[str, dict]]:
    """Returns [(stem, record), ...] sorted by stem. Raises FileNotFoundError
    if the figcheck directory itself is missing."""
    d = abspath(FIGCHECK_DIR)
    if not os.path.isdir(d):
        raise FileNotFoundError(f"{FIGCHECK_DIR} does not exist")
    records = []
    for fname in sorted(os.listdir(d)):
        if not fname.endswith(".json"):
            continue
        stem = fname[:-5]
        with open(os.path.join(d, fname), encoding="utf-8") as fh:
            records.append((stem, json.load(fh)))
    return records


def load_triage_dispositions() -> dict[str, set[str]]:
    """Fragment stem -> set of leading disposition tokens named for it
    anywhere in FIGURE-TRIAGE.md. Tolerant: an unreadable or unparsed file
    just yields an empty map (no waivers get seeded), since this script must
    not become unable to render because the triage doc broke."""
    path = abspath(TRIAGE_REL)
    out: dict[str, set[str]] = {}
    if not os.path.isfile(path):
        return out
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    for line in text.split("\n"):
        if not TRIAGE_ROW_RE.match(line):
            continue
        cells = split_table_row(line)
        if len(cells) != 7:
            continue
        _idx, fragment, _idea, _drawn, _role, disposition, _spec = cells
        frag = SHARED_SUFFIX_RE.sub("", fragment).strip()
        if frag in ("—", "-", ""):
            continue
        token = disposition.replace("*", "").strip().split(" ")[0].split("(")[0].strip()
        # A disposition often carries a parenthetical naming the work it
        # requires -- "keep (labels bigger)", "keep (labels \\footnotesize;
        # drop diamonds for text AND)". That is scheduled work, not a clean
        # bill, and reading only the leading token loses the difference: both
        # of those figures were marked keep and both fail figcheck on exactly
        # the defect their own parenthetical names. A keep with a note is
        # recorded as `keep+note` so the waiver rules can tell it from a keep
        # that claims the figure is finished.
        if token == "keep" and "(" in disposition:
            token = "keep+note"
        out.setdefault(frag, set()).add(token)
    return out


def committed_first_seen() -> dict[str, str]:
    """The `first_seen` date already recorded for each blocker id in the
    committed blockers.json, or an empty map if the file is absent or
    unreadable. This is the primary source: once a blocker's first sighting
    has been written down, that date is a fact about the past and must not be
    recomputed."""
    path = os.path.join(REPO_ROOT, BLOCKERS_REL)
    try:
        with open(path, encoding="utf-8") as handle:
            existing = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(existing, list):
        return {}
    return {
        entry["id"]: entry["first_seen"]
        for entry in existing
        if isinstance(entry, dict) and "id" in entry and "first_seen" in entry
    }


def first_seen(rel_path: str) -> str:
    """The date this figure's record was first written down, as YYYY-MM-DD,
    for a blocker not already carried in the committed blockers.json.

    Git is asked first and today is the fallback, but neither is consulted for
    an id the committed file already knows -- see `committed_first_seen`. That
    ordering is the whole point: `git log` answers differently on a shallow
    clone (CI checks out with `fetch-depth: 1`, so the file's introducing
    commit is not in the clone) than on a full one, and a value that changes
    with clone depth would fail the freshness check on every CI run while
    passing on every developer's machine."""
    try:
        out = subprocess.run(
            ["git", "log", "--follow", "--format=%ad", "--date=short", "--", rel_path],
            cwd=REPO_ROOT, capture_output=True, text=True, check=False,
        )
        dates = [line for line in out.stdout.strip().split("\n") if line]
        if dates:
            return dates[-1]
    except OSError:
        pass
    return date.today().isoformat()


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def render_digest(records: list[tuple[str, dict]]) -> str:
    lines = []
    lines.append("# Figure audit digest")
    lines.append("")
    lines.append(
        "Generated by `scripts/harbor-research/render_figure_audit.py --write` from "
        f"`{FIGCHECK_DIR}/*.json`. Do not hand-edit -- re-run figcheck.py on a fragment "
        "and re-run `--write` instead."
    )
    lines.append("")
    lines.append("| fragment | chapter | result | failed checks | warned checks |")
    lines.append("|---|---|---|---|---|")
    n_pass = n_fail = 0
    per_check_fail = {c: 0 for c in ALL_CHECKS}
    per_check_warn = {c: 0 for c in ALL_CHECKS}
    for stem, rec in records:
        chapter = chapter_for_stem(stem)
        summary = rec["summary"]
        result = summary["result"]
        if result == "pass":
            n_pass += 1
        else:
            n_fail += 1
        for c in summary.get("failed_checks", []):
            per_check_fail[c] = per_check_fail.get(c, 0) + 1
        for c in summary.get("warned_checks", []):
            per_check_warn[c] = per_check_warn.get(c, 0) + 1
        chapter_str = str(chapter) if chapter is not None else "?"
        failed = ", ".join(summary.get("failed_checks", [])) or "—"
        warned = ", ".join(summary.get("warned_checks", [])) or "—"
        lines.append(f"| {stem} | {chapter_str} | {result} | {failed} | {warned} |")
    lines.append("")
    lines.append("## Totals")
    lines.append("")
    lines.append(f"- fragments checked: {len(records)}")
    lines.append(f"- pass: {n_pass}")
    lines.append(f"- fail: {n_fail}")
    for c in ALL_CHECKS:
        if per_check_fail.get(c) or per_check_warn.get(c):
            lines.append(f"- {c}: {per_check_fail.get(c, 0)} failed, {per_check_warn.get(c, 0)} warned")
    lines.append("")
    return "\n".join(lines)


def render_failures(records: list[tuple[str, dict]]) -> str:
    lines = []
    lines.append("# Figure audit failures")
    lines.append("")
    lines.append(
        "Generated by `scripts/harbor-research/render_figure_audit.py --write` from "
        f"`{FIGCHECK_DIR}/*.json`. One section per fragment whose latest figcheck run "
        "failed, with each failed check's finding count and first finding message "
        "(deterministic: findings are in the order figcheck.py wrote them)."
    )
    lines.append("")
    failing = [(stem, rec) for stem, rec in records if rec["summary"]["result"] != "pass"]
    if not failing:
        lines.append("No failing fragments.")
        lines.append("")
        return "\n".join(lines)
    for stem, rec in failing:
        lines.append(f"## {stem}")
        lines.append("")
        checks = rec.get("checks", {})
        for code in ALL_CHECKS:
            check = checks.get(code)
            if not check or check.get("status") not in ("fail", "warn"):
                continue
            findings = check.get("findings", [])
            count = check.get("count", len(findings))
            lines.append(f"- **{code}** ({check['status']}, {count} finding(s))")
            if findings:
                msg = findings[0].get("message", "")
                lines.append(f"  - {msg}")
        lines.append("")
    return "\n".join(lines)


def render_blockers(records: list[tuple[str, dict]]) -> list[dict]:
    dispositions = load_triage_dispositions()
    already_recorded = committed_first_seen()
    blockers = []
    for stem, rec in records:
        failed = [c for c in rec["summary"].get("failed_checks", []) if c in T1_T5]
        if not failed:
            continue
        chapter = chapter_for_stem(stem)
        fragment_path = find_fragment_path(stem)
        rel_json_path = f"{FIGCHECK_DIR}/{stem}.json"
        waiver = None
        stem_dispositions = dispositions.get(stem, set())
        if stem_dispositions & WAIVER_DISPOSITIONS:
            waiver = {"reason": WAIVER_REASON, "expires": WAIVER_EXPIRES}
        elif stem_dispositions & BACKLOG_DISPOSITIONS:
            waiver = {"reason": BACKLOG_REASON, "expires": WAIVER_EXPIRES}
        blockers.append({
            "id": stem,
            "fragment": fragment_path,
            "chapter": chapter,
            "checks_failed": failed,
            "first_seen": already_recorded.get(stem) or first_seen(rel_json_path),
            "waiver": waiver,
        })
    blockers.sort(key=lambda b: b["id"])
    return blockers


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    global REPO_ROOT
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="fail if the committed outputs are stale")
    parser.add_argument("--write", action="store_true", help="(re)write the committed outputs")
    parser.add_argument("--repo-root", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.repo_root:
        REPO_ROOT = os.path.abspath(args.repo_root)

    try:
        records = load_figcheck_records()
    except FileNotFoundError as e:
        print(f"FATAL: {e}", file=sys.stderr)
        return 1

    digest = render_digest(records)
    failures_md = render_failures(records)
    blockers = render_blockers(records)
    blockers_json = json.dumps(blockers, indent=2, sort_keys=False) + "\n"

    outputs = [
        (DIGEST_REL, digest),
        (FAILURES_REL, failures_md),
        (BLOCKERS_REL, blockers_json),
    ]

    if not args.check and not args.write:
        for _rel, content in outputs:
            print(content)
        return 0

    exit_code = 0

    if args.check:
        stale = []
        for rel_path, content in outputs:
            p = abspath(rel_path)
            on_disk = None
            if os.path.isfile(p):
                with open(p, encoding="utf-8") as fh:
                    on_disk = fh.read()
            if on_disk != content:
                stale.append(rel_path)
        if stale:
            print("STALE (run --write to regenerate):", file=sys.stderr)
            for rel_path in stale:
                print(f"  {rel_path}", file=sys.stderr)
            exit_code = 1
        else:
            print("All figure audit outputs are fresh.")

    if args.write:
        for rel_path, content in outputs:
            p = abspath(rel_path)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(content)
            print(f"wrote {rel_path} ({len(content)} bytes)")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
