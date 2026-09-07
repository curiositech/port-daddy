#!/usr/bin/env python3
"""ProVerif result-drift checker for the Port Daddy proof estate.

Discovers every `.pv` model under the three roots the project treats as
ProVerif protocol claims -- analyses/, proofs/** and docs/adr/models/ -- runs
ProVerif on each (when the `proverif` binary is available), and compares the
model's outcome lines (the lines ProVerif prints starting with `RESULT `)
against the committed evidence file next to it:

    analyses/**, docs/adr/models/**   ->  <stem>_results.txt
    proofs/**                         ->  <stem>.run.log

`skills/pd-relay-zero-trust/templates/proverif-relay.pv` is deliberately NOT
in scope: it is a skill teaching template (open TODO queries, no committed
evidence, not a claim about a real Port Daddy protocol) and is tracked as
RETIRED in whitepaper/corpus.json instead of run here.

Two modes, mutually exclusive:

  --check
      Compare-only. Never writes to the tree. Exits nonzero when:
        * a freshly-run model's RESULT lines differ from its committed
          baseline ("drift" -- the model changed but the evidence wasn't
          regenerated, or vice versa);
        * a negative-control model (filename matching `*_vuln*.pv` or
          `*naive_unsound*.pv`) does not report at least one `is false.`
          RESULT -- the check that the checker itself is not vacuous;
        * ProVerif produces no RESULT lines at all for a model (crash or a
          malformed invocation).
      A model with NO committed baseline is reported (with its freshly-run
      RESULT lines) but is NOT a failure -- this script never invents an
      expected result to compare against.

      When the `proverif` binary is not on PATH, --check degrades to a
      *structural* pass: it does not invoke the (missing) binary at all, and
      instead validates the shape of the committed baseline files themselves
      (they parse into at least one RESULT line; negative controls' committed
      baselines contain a genuine `is false.`). This is what lets the
      comparison logic -- and the whole estate's bookkeeping -- be exercised
      and CI-validated without ProVerif installed. See
      tests/unit/proverif-runner-comparison.test.mjs.

  --record
      Re-runs ProVerif (which MUST be on PATH -- this mode refuses to invent
      results) and (re)writes the full transcript to each model's evidence
      file, creating one at the conventional path for any model that doesn't
      have one yet.

Stdlib-only. No third-party imports.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Discovery and naming conventions
# ---------------------------------------------------------------------------

# The three roots this task scopes ProVerif model evidence to.
SCAN_ROOTS = ("analyses", "proofs", "docs/adr/models")

# harbor_card_v2..v7's committed evidence predates this runner and was named
# by version number only, dropping the model's descriptive filename suffix
# (harbor_card_v2_asymmetric.pv -> harbor_card_v2_results.txt). This table is
# the one and only bridge for that historical naming gap -- deliberately NOT
# a generic "strip the trailing _suffix" rule, because a generic rule would
# ALSO match harbor_card_v1_refined.pv against harbor_card_v1_results.txt,
# which would be wrong: v1_refined is a distinct model from v1 and has never
# had its own evidence committed (see the "no baseline" path). Do not add a
# guessed entry for v1_refined here -- it deliberately has none.
BASELINE_NAME_OVERRIDES = {
    "analyses/harbor_card_v2_asymmetric.pv": "analyses/harbor_card_v2_results.txt",
    "analyses/harbor_card_v3_delegation.pv": "analyses/harbor_card_v3_results.txt",
    "analyses/harbor_card_v4_escrow_secrecy.pv": "analyses/harbor_card_v4_results.txt",
    "analyses/harbor_card_v5_attenuation.pv": "analyses/harbor_card_v5_results.txt",
    "analyses/harbor_card_v6_multihop_attack.pv": "analyses/harbor_card_v6_results.txt",
    "analyses/harbor_card_v7_multihop_fixed.pv": "analyses/harbor_card_v7_results.txt",
}

# Filenames matching either glob are treated as negative controls: models
# that exist specifically to demonstrate an attack or an unsound variant, so
# the checker asserts they FAIL their query. A clean sweep can then never
# mean "the checker went vacuous and stopped noticing failures."
NEGATIVE_CONTROL_GLOBS = ("*_vuln*.pv", "*naive_unsound*.pv")

_RESULT_LINE_RE = re.compile(r"^RESULT ")
_FALSE_RESULT_RE = re.compile(r"is false\.\)?\s*$")


def discover_pv_files(root: Path) -> list[Path]:
    """Every `.pv` file under the three in-scope roots, repo-root-relative."""
    found: list[Path] = []
    for rel_root in SCAN_ROOTS:
        base = root / rel_root
        if not base.is_dir():
            continue
        found.extend(base.rglob("*.pv"))
    return sorted(set(found))


def is_negative_control(pv_path: Path) -> bool:
    name = pv_path.name
    return any(fnmatch.fnmatch(name, pattern) for pattern in NEGATIVE_CONTROL_GLOBS)


def resolve_baseline(root: Path, pv_path: Path) -> Optional[Path]:
    """The committed evidence file for `pv_path`, or None if there isn't one."""
    rel = pv_path.relative_to(root).as_posix()
    stem_rel = rel[: -len(".pv")]
    for suffix in ("_results.txt", ".run.log"):
        candidate = root / f"{stem_rel}{suffix}"
        if candidate.is_file():
            return candidate
    override = BASELINE_NAME_OVERRIDES.get(rel)
    if override:
        candidate = root / override
        if candidate.is_file():
            return candidate
    return None


def default_baseline_path(root: Path, pv_path: Path) -> Path:
    """Where --record writes evidence for a model with no existing baseline."""
    rel = pv_path.relative_to(root).as_posix()
    stem_rel = rel[: -len(".pv")]
    top = rel.split("/", 1)[0]
    suffix = "_results.txt" if top in ("analyses", "docs") else ".run.log"
    return root / f"{stem_rel}{suffix}"


def extract_result_lines(text: str) -> list[str]:
    """The `RESULT ...` outcome lines from a ProVerif transcript, in order."""
    return [line.rstrip() for line in text.splitlines() if _RESULT_LINE_RE.match(line)]


def has_false_result(lines: list[str]) -> bool:
    """True if any RESULT line reports a false query (an attack/violation)."""
    return any(_FALSE_RESULT_RE.search(line) for line in lines)


def find_proverif_binary(explicit: Optional[str]) -> Optional[str]:
    if explicit:
        resolved = shutil.which(explicit)
        if resolved:
            return resolved
        return explicit if Path(explicit).is_file() and os.access(explicit, os.X_OK) else None
    return shutil.which("proverif")


def run_proverif_model(root: Path, binary: str, pv_path: Path) -> str:
    """Run ProVerif on one model; return its combined stdout+stderr transcript.

    Invoked from `root` with the repo-root-relative path (not `cd`'d into the
    model's own directory) so ProVerif's own diagnostics -- e.g. "Warning:
    identifier sid rebound" prints the path it was invoked with -- match the
    existing committed evidence byte-for-byte instead of differing only in
    how much of the path was visible to the warning message. None of the
    in-scope models use ProVerif's `#include`, so this has no effect on
    resolution.
    """
    proc = subprocess.run(
        [binary, pv_path.relative_to(root).as_posix()],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=600,
    )
    transcript = proc.stdout
    if proc.stderr:
        transcript += ("\n" if transcript and not transcript.endswith("\n") else "") + proc.stderr
    return transcript


# ---------------------------------------------------------------------------
# --check
# ---------------------------------------------------------------------------


@dataclass
class ModelOutcome:
    rel_path: str
    baseline_rel: Optional[str]
    negative_control: bool
    mode: str  # "executed" | "structural" | "no-binary-no-baseline"
    lines: list[str]
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def compute_check(root: Path, binary: Optional[str]) -> tuple[int, list[ModelOutcome]]:
    outcomes: list[ModelOutcome] = []
    for pv_path in discover_pv_files(root):
        rel = pv_path.relative_to(root).as_posix()
        baseline = resolve_baseline(root, pv_path)
        baseline_rel = baseline.relative_to(root).as_posix() if baseline else None
        neg = is_negative_control(pv_path)
        problems: list[str] = []

        if binary:
            transcript = run_proverif_model(root, binary, pv_path)
            actual = extract_result_lines(transcript)
            mode = "executed"
            if not actual:
                problems.append(
                    "proverif produced no RESULT lines (crash, parse error, "
                    "or a query-free model) -- see the run's full output"
                )
            if baseline is not None:
                expected = extract_result_lines(baseline.read_text(encoding="utf-8"))
                if actual != expected:
                    problems.append(
                        f"RESULT lines drifted from {baseline_rel}:\n"
                        f"    expected: {expected}\n"
                        f"    actual:   {actual}"
                    )
            if neg and not has_false_result(actual):
                problems.append(
                    "negative-control model did not report any 'is false.' "
                    "RESULT on this run -- the checker may have gone vacuous"
                )
            lines = actual
        elif baseline is not None:
            expected = extract_result_lines(baseline.read_text(encoding="utf-8"))
            mode = "structural"
            if not expected:
                problems.append(
                    f"committed baseline {baseline_rel} has no RESULT lines to compare against"
                )
            if neg and not has_false_result(expected):
                problems.append(
                    "negative-control model's committed baseline does not report "
                    "any 'is false.' RESULT -- the checker may have gone vacuous"
                )
            lines = expected
        else:
            mode = "no-binary-no-baseline"
            lines = []

        outcomes.append(ModelOutcome(rel, baseline_rel, neg, mode, lines, problems))

    exit_code = 1 if any(not o.ok for o in outcomes) else 0
    return exit_code, outcomes


def render_summary(outcomes: list[ModelOutcome], proverif_available: bool) -> str:
    unbaselined = [o for o in outcomes if o.baseline_rel is None]
    failing = [o for o in outcomes if not o.ok]

    out = []
    out.append("# ProVerif estate check")
    out.append("")
    out.append(
        "ProVerif binary: "
        + ("found -- every model re-run and compared" if proverif_available
           else "NOT found -- structural compare-only against committed evidence")
    )
    out.append("")
    out.append(
        f"{len(outcomes)} model(s) scanned, {len(unbaselined)} without a "
        f"committed baseline, {len(failing)} failing."
    )

    if unbaselined:
        out.append("")
        out.append("## Models without a committed baseline")
        out.append("(not invented, not treated as a failure -- run `--record` once ProVerif is available)")
        for o in unbaselined:
            out.append(f"- `{o.rel_path}`")
            for line in o.lines:
                out.append(f"    {line}")

    if failing:
        out.append("")
        out.append("## Failures")
        for o in failing:
            out.append(f"- `{o.rel_path}`")
            for problem in o.problems:
                out.append(f"    {problem}")

    out.append("")
    out.append("## All models")
    out.append("")
    out.append("| model | baseline | negative control | mode | status |")
    out.append("|---|---|---|---|---|")
    for o in outcomes:
        baseline_cell = f"`{o.baseline_rel}`" if o.baseline_rel else "_none_"
        out.append(
            f"| `{o.rel_path}` | {baseline_cell} | {'yes' if o.negative_control else ''} "
            f"| {o.mode} | {'OK' if o.ok else 'FAIL'} |"
        )
    out.append("")
    return "\n".join(out)


def check_cmd(root: Path, explicit_bin: Optional[str]) -> int:
    binary = find_proverif_binary(explicit_bin)
    exit_code, outcomes = compute_check(root, binary)
    summary = render_summary(outcomes, proverif_available=bool(binary))
    print(summary)

    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(summary)
            fh.write("\n")

    return exit_code


# ---------------------------------------------------------------------------
# --record
# ---------------------------------------------------------------------------


def record_cmd(root: Path, explicit_bin: Optional[str]) -> int:
    binary = find_proverif_binary(explicit_bin)
    if not binary:
        print(
            "ERROR: --record requires the `proverif` binary on PATH (or "
            "--proverif-bin); refusing to invent results.",
            file=sys.stderr,
        )
        return 2

    written: list[str] = []
    skipped: list[str] = []
    for pv_path in discover_pv_files(root):
        rel = pv_path.relative_to(root).as_posix()
        transcript = run_proverif_model(root, binary, pv_path)
        if not extract_result_lines(transcript):
            skipped.append(rel)
            print(
                f"WARNING: {rel} produced no RESULT lines; not writing a baseline for it.",
                file=sys.stderr,
            )
            continue
        target = resolve_baseline(root, pv_path) or default_baseline_path(root, pv_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(transcript, encoding="utf-8")
        written.append(target.relative_to(root).as_posix())

    print(f"Wrote {len(written)} evidence file(s):")
    for path in written:
        print(f"  {path}")
    if skipped:
        print(f"Skipped {len(skipped)} model(s) with no RESULT lines:")
        for path in skipped:
            print(f"  {path}")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--check", action="store_true", help="Compare-only; never writes to the tree."
    )
    mode.add_argument(
        "--record",
        action="store_true",
        help="Re-run ProVerif and (re)write the committed evidence files.",
    )
    parser.add_argument(
        "--root",
        default=None,
        help="Repository root to scan (default: the real repo root, inferred "
        "from this script's location). Tests point this at a fixture directory.",
    )
    parser.add_argument(
        "--proverif-bin",
        default=None,
        help="Path to the proverif binary (default: `proverif` on PATH).",
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[2]

    if args.record:
        return record_cmd(root, args.proverif_bin)
    return check_cmd(root, args.proverif_bin)


if __name__ == "__main__":
    raise SystemExit(main())
