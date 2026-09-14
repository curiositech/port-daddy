# Examples

`chapter1-lint-report.txt` — the actual output of `chapter_lint.py` against
Chapter 1 (the single-writer kernel) as it stands at this skill's most recent
revision. Regenerate it after any change to the chapter or the script, **from
the repository root** (the chapter path in the report is repo-relative, and
the report's first line records it):

```bash
python3 skills/textbook-craft/scripts/chapter_lint.py \
  whitepaper/single-writer-kernel.tex \
  > skills/textbook-craft/examples/chapter1-lint-report.txt
```

Chapter 1 has since adopted the Wave 12 page-grammar rewrite
(`whitepaper/figures/pd-pedagogy.tex`) and relocated its exercises to a
closing `Exercises` section, so most floors now pass. It still fails
`worked_example_per_section` (9 of its 12 **body** sections have no worked
example; its 8 apparatus sections are exempt and are listed by name near the
foot of the report) and `claims_carry_epistemic_kind` (8 of 13
theorem/property/definition environments carry no kind tag inside their own
body) — a chapter can adopt the shared apparatus and still leave floors unmet
section by section, which is exactly what a DO-CONFIRM checklist
(`references/canon.md` §Gawande) is for.
`chapter_opener_and_claim_labeling` reports WARN, not FAIL, because it is
advisory: no chapter in the corpus yet opens with an `\epigraph` macro.

`consolidated-lint-report.txt` — the one-table report `chapter_lint.py`
produces when it is given more than one chapter (or `--table`), run with no
arguments at all so it reads its own chapter list from
`whitepaper/textbook.json` (the same convention
`skills/tufte-evidence-design/scripts/margin_lint.py` uses):

```bash
python3 skills/textbook-craft/scripts/chapter_lint.py --repo-root . \
  > skills/textbook-craft/examples/consolidated-lint-report.txt
```

(`--repo-root .` keeps the chapter paths repo-relative; without it they come
out absolute and the committed file churns on every machine.)

This is the report CI reads: one row per (chapter, floor), a PASS/FAIL/WARN
status column (WARN is an advisory floor left unmet — it never fails
`--strict`), and a one-line summary of how many rows are genuinely blocking
versus merely advisory. Read the summary line first; read individual rows
when a chapter needs fixing.

The summary line is also the CI ratchet's number. `library-checks.yml` runs
`chapter_lint.py --max-blocking 17`, so this file's
`17 blocking failure(s)` and that flag have to be changed together — lower
both when a chapter clears a floor, and never raise either.
