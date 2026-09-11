#!/usr/bin/env python3
"""run_pdf_checks.py -- the one command for every check that needs a
rendered PDF.

Two checks read the freshly built editions today: page_overflow.py (margin
collisions, ink off the paper, text over the running foot) and
check_cover_title_band.py's page half (type set illegibly over a plate).
Before this script they were named one at a time in whitepaper-build.yml's
"Nothing on any page is where a reader cannot read it" step -- which is
exactly how a checker gets written, works, and then never runs anywhere
(scripts/harbor-research/check_plate_provenance.py sat unwired that way
until this round; see the library-checks.yml history). A step that calls
this script instead of naming scripts runs whatever is registered below,
so the next page-reading check gets picked up by adding one line here, not
by remembering to also edit the CI step.

page_spills.py is deliberately NOT registered below. It is a real,
finished checker, but it is red on the Book as committed (two stranded
headings, pp. 165 and 246 of the maritime edition) -- wiring a red check
into a required gate is the opposite of this script's purpose. Fix those
two headings, confirm page_spills.py is green on all three editions, then
add it to PER_PDF_CHECKS.

Usage:
    python3 scripts/harbor-research/run_pdf_checks.py --pdf-dir DIR
    python3 scripts/harbor-research/run_pdf_checks.py --pdf-dir DIR --expect 1
    python3 scripts/harbor-research/run_pdf_checks.py PDF [PDF ...]

Exit 1 if handed no PDFs to check (a check that can pass having checked
nothing is a defect in the check, not a pass), if --expect says how many
there should be and fewer or more arrived, or if any registered check fails
on any PDF.

--expect closes the half of the empty-artifact hole the zero case leaves
open. "No PDFs at all" already fails; "two of the three editions" did not,
and read as a pass over whichever edition went missing -- the same shape of
fail-open as the green cover-band that had checked nothing, one edition
narrower. The caller knows the count (whitepaper-build.yml uploads exactly
the editions it names, if-no-files-found: error), so it can say it, and
tests/unit/pdf-reader-pins.test.js keeps the number it says equal to the
number the upload step lists. That number is 1 today: the Book has one
central edition -- whichever character \\pdedition defaults to in
coordination-papers-mega-volume-preamble.tex, rendered into the canonical
coordination-papers-mega-volume.pdf -- and the other two characters are
switchable but not built.
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

# Every check that takes ONE pdf path as its argument. Add a new one here,
# not as a new step in whitepaper-build.yml.
PER_PDF_CHECKS = [
    (os.path.join(REPO_ROOT, "scripts", "harbor-research", "page_overflow.py"), []),
    # Joined 2026-09-08, which is what the docstring below was waiting for: the
    # two stranded headings are fixed at the source (a \needspace before each,
    # not a loosened threshold), and the eight "O" findings that stood in the
    # way turned out to be the check's own defect -- an absolute font-size test
    # that one edition's typeface missed by 0.07 pt. All three editions now
    # report 0 O and 0 H. W findings stay advisory and do not fail the run.
    (os.path.join(REPO_ROOT, "scripts", "harbor-research", "page_spills.py"), []),
]

# Every check that takes the whole directory of freshly built editions at
# once (a page-fit check that compares across editions, say). Add a new one
# here in the same way.
PER_DIR_CHECKS = [
    (
        os.path.join(REPO_ROOT, "scripts", "whitepaper-plates", "check_cover_title_band.py"),
        lambda pdf_dir: ["--pdf-dir", pdf_dir],
    ),
]


def collect_pdfs(args: argparse.Namespace) -> list[str]:
    if args.pdf_dir:
        return sorted(glob.glob(os.path.join(args.pdf_dir, "*.pdf")))
    return list(args.pdfs)


def run(cmd: list[str]) -> tuple[int, str]:
    """Run one check, print everything it said, and hand back what it said.

    The output is captured and then printed rather than streamed. That costs
    live progress on a check that takes a few seconds, and buys the thing the
    log alone could not give: the finding itself, quoted into the run summary
    by `summarize` below. Today a red cover-band means opening the job log and
    reading a few hundred lines to learn "p309, 8.2 pt" -- the measurement is
    there, and nothing puts it where the failure is announced.
    """
    full_cmd = [sys.executable, *cmd]
    print(f"$ {' '.join(full_cmd)}")
    proc = subprocess.run(full_cmd, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    return proc.returncode, out


# A finding header from the page checks: "-- 3 page/kind rows with loss ...".
# "-- 0 ..." is the clean case and is deliberately not matched, and neither is
# "-- advisory: 52 ...": a check may report rows it does not fail on, and
# quoting those into a failure summary buries the finding that caused the red
# under the ones that did not. A check says which is which; this reads it.
FINDING_HEADER = re.compile(r"^-{2}\s*(?!advisory\b)[1-9]\d*\s")
ADVISORY_HEADER = re.compile(r"^-{2}\s*advisory\b")
# A per-page detail row: "p309 text off-page 8.2 pt ..." / "p 21 +108.0 pt ...".
DETAIL_ROW = re.compile(r"^p\s*\d+\b")


def salient(output: str, max_rows: int = 12) -> list[str]:
    """The lines worth quoting: every nonzero finding header, with the detail
    rows under it, capped so one loud check cannot bury the others. When a
    check reports in some other shape, fall back to its last lines rather than
    quoting nothing -- an unrecognized format is not a reason to say less."""
    lines = [ln.rstrip() for ln in output.splitlines()]
    picked: list[str] = []
    i = 0
    while i < len(lines):
        if FINDING_HEADER.match(lines[i]):
            picked.append(lines[i])
            rows = 0
            i += 1
            while i < len(lines) and DETAIL_ROW.match(lines[i]) and rows < max_rows:
                picked.append(f"    {lines[i]}")
                rows, i = rows + 1, i + 1
            if i < len(lines) and DETAIL_ROW.match(lines[i]):
                picked.append("    ...")
                while i < len(lines) and DETAIL_ROW.match(lines[i]):
                    i += 1
            continue
        i += 1
    if picked:
        return picked
    tail = [ln for ln in lines if ln.strip()][-8:]
    return tail


def summarize(failures: list[tuple[str, str, str]]) -> None:
    """Write the failing checks and what they found to the run summary, so the
    defect is legible where the red mark is rather than only in the log."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    parts = ["### Pages a reader could not read", ""]
    for name, target, output in failures:
        parts.append(f"**{name}** — `{target}`")
        parts.append("")
        parts.append("```")
        parts.extend(salient(output))
        parts.append("```")
        parts.append("")
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(parts) + "\n")
    except OSError:
        pass  # the summary is best-effort; the exit code is the gate


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdfs", nargs="*", help="PDF paths to check")
    parser.add_argument("--pdf-dir", help="directory holding freshly built PDFs (checks every *.pdf in it)")
    parser.add_argument(
        "--expect",
        type=int,
        metavar="N",
        help="how many PDFs the caller knows should be here; a short (or long) count fails",
    )
    args = parser.parse_args()

    pdfs = collect_pdfs(args)
    if not pdfs:
        where = args.pdf_dir or "(no --pdf-dir or PDF given)"
        print(f"::error::no PDFs found to check ({where}) -- this cannot pass having checked nothing", file=sys.stderr)
        return 1

    if args.expect is not None and len(pdfs) != args.expect:
        found = ", ".join(os.path.basename(p) for p in pdfs) or "(none)"
        print(
            f"::error::expected {args.expect} PDF(s) to check, found {len(pdfs)}: {found}"
            " -- checking a subset and reporting green is the fail-open this flag exists to stop."
            " Either the build did not produce every edition, the artifact arrived incomplete,"
            " or the edition list changed and --expect was not moved with it.",
            file=sys.stderr,
        )
        return 1

    print(f"checking {len(pdfs)} PDF(s): {', '.join(os.path.basename(p) for p in pdfs)}")

    failures: list[tuple[str, str, str]] = []

    for script, extra_args in PER_PDF_CHECKS:
        name = os.path.basename(script)
        for pdf in pdfs:
            print(f"\n== {name} -- {os.path.basename(pdf)} ==")
            rc, out = run([script, pdf, *extra_args])
            if rc != 0:
                failures.append((name, os.path.basename(pdf), out))

    pdf_dir = args.pdf_dir or os.path.dirname(os.path.abspath(pdfs[0]))
    for script, extra_args_fn in PER_DIR_CHECKS:
        name = os.path.basename(script)
        print(f"\n== {name} -- {pdf_dir} ==")
        rc, out = run([script, *extra_args_fn(pdf_dir)])
        if rc != 0:
            failures.append((name, pdf_dir, out))

    print()
    if failures:
        print(f"run_pdf_checks: FAIL ({len(failures)} check/PDF combination(s) failed)")
        for name, target, _ in failures:
            print(f"  - {name} failed on {target}")
        summarize(failures)
        return 1
    print(
        f"run_pdf_checks: {len(pdfs)} PDF(s), "
        f"{len(PER_PDF_CHECKS)} per-PDF check(s), {len(PER_DIR_CHECKS)} per-directory check(s) -- all clean"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
