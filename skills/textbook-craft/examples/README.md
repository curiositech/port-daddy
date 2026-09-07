# Examples

`chapter1-lint-report.txt` — the actual output of
`python3 scripts/chapter_lint.py whitepaper/single-writer-kernel.tex`, captured
against Chapter 1 (the single-writer kernel) as it stands at this skill's
authoring commit. Regenerate it after any change to the chapter or the
script:

```bash
python3 scripts/chapter_lint.py whitepaper/single-writer-kernel.tex \
  > examples/chapter1-lint-report.txt
```

Read this file to see what a real, unfixed floor violation looks like before
running the linter yourself — five of six floors fail on this chapter today
(worked examples, exercise placement, claim tagging, tinted boxes, and the
chapter-close apparatus), because it predates the Wave 12 page-grammar rewrite
(`whitepaper/figures/pd-pedagogy.tex`) and was written before this skill
existed. That is expected, not a bug in the linter: it is the honest baseline
this skill's `SKILL.md` and `references/` exist to move the Book away from.
For a chapter that already adopted the new apparatus, run the same command
against `whitepaper/legible-swarm.tex` once it lands on `main` — it passes
`exercises_at_chapter_end`, `no_tinted_box_macros`, and `chapter_close_apparatus`
because it `\input{figures/pd-pedagogy}` and groups its exercises at chapter
end, but still fails `worked_example_per_section` and
`claims_carry_epistemic_kind` on some sections — a chapter can adopt the
apparatus and still leave floors unmet section by section, which is exactly
what a DO-CONFIRM checklist (`references/canon.md` §Gawande) is for.
