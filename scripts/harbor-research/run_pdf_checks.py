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
    python3 scripts/harbor-research/run_pdf_checks.py PDF [PDF ...]

Exit 1 if handed no PDFs to check (a check that can pass having checked
nothing is a defect in the check, not a pass), or if any registered check
fails on any PDF.
"""
from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

# Every check that takes ONE pdf path as its argument. Add a new one here,
# not as a new step in whitepaper-build.yml.
PER_PDF_CHECKS = [
    (os.path.join(REPO_ROOT, "scripts", "harbor-research", "page_overflow.py"), []),
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


def run(cmd: list[str]) -> int:
    full_cmd = [sys.executable, *cmd]
    print(f"$ {' '.join(full_cmd)}")
    return subprocess.run(full_cmd).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("pdfs", nargs="*", help="PDF paths to check")
    parser.add_argument("--pdf-dir", help="directory holding freshly built PDFs (checks every *.pdf in it)")
    args = parser.parse_args()

    pdfs = collect_pdfs(args)
    if not pdfs:
        where = args.pdf_dir or "(no --pdf-dir or PDF given)"
        print(f"::error::no PDFs found to check ({where}) -- this cannot pass having checked nothing", file=sys.stderr)
        return 1

    print(f"checking {len(pdfs)} PDF(s): {', '.join(os.path.basename(p) for p in pdfs)}")

    failures: list[str] = []

    for script, extra_args in PER_PDF_CHECKS:
        name = os.path.basename(script)
        for pdf in pdfs:
            print(f"\n== {name} -- {os.path.basename(pdf)} ==")
            rc = run([script, pdf, *extra_args])
            if rc != 0:
                failures.append(f"{name} failed on {os.path.basename(pdf)}")

    pdf_dir = args.pdf_dir or os.path.dirname(os.path.abspath(pdfs[0]))
    for script, extra_args_fn in PER_DIR_CHECKS:
        name = os.path.basename(script)
        print(f"\n== {name} -- {pdf_dir} ==")
        rc = run([script, *extra_args_fn(pdf_dir)])
        if rc != 0:
            failures.append(f"{name} failed on {pdf_dir}")

    print()
    if failures:
        print(f"run_pdf_checks: FAIL ({len(failures)} check/PDF combination(s) failed)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"run_pdf_checks: {len(pdfs)} PDF(s), "
        f"{len(PER_PDF_CHECKS)} per-PDF check(s), {len(PER_DIR_CHECKS)} per-directory check(s) -- all clean"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
