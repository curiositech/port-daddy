# Textbook Craft — Changelog

## v1.4.0 (2026-09-20)

- Retain the body/apparatus measurement and bounded-gate intent of #10202
  without its proposed title-keyword exemptions. Author-declared metadata
  selects exact heading labels or unique exact titles; undeclared sections
  stay body. No chapter/PDF blobs from that older PR are restored.
- Citation-spread hints identify section spans, so repeated titles no longer
  collapse distinct citation sites. Pedagogy-file discovery assertions compare
  canonical paths across macOS aliases.
- Body-only example coverage and opener selection; duplicate headings count
  independently, all-apparatus chapters fail, and apparatus claims remain
  subject to honesty checks. Reports expose the exclusions.
- Stale or ambiguous metadata fails closed, including declarations for
  unselected chapters. `--max-blocking N` permits a measured aggregate debt
  budget without hiding failures or ignoring invalid input.
- Corpus role declarations and CI activation require source-owner agreement;
  the historical budget of 17 must not be copied without remeasurement.

## v1.3.0 (2026-09-15)

`scripts/readers_eye.py` and `references/readers-eye-lexicon.json` landed in
v1.2.0 without the two pieces that make the tool usable and testable:
`references/readers-eye.md` (the Layer-2 judge rubric — the reader's
persona, the finding shape, and the corpus baseline the six mechanical rules
were tuned against) and `tests/harbor-research/test_readers_eye.py` (28
cases pinning the edge cases found while tuning, including the specimen
paragraph's own findings so a future tuning pass cannot quietly stop
flagging it). Both are added here, along with the three `library-checks.yml`
CI steps that actually run the tool (unit tests, the `--selftest`
clean-vs-bad fixture gate, and an advisory full-corpus pass) — none of which
had been wired in.

## v1.2.0 (2026-09-14)

Two floors reported success while not doing their job. Both were found by
workers running `chapter_lint.py` over real chapters; both are fixed in the
checker, not in the chapters.

- `exercises_at_chapter_end` mistook a section for the Exercises section.
  `website-v2/public/whitepaper/spawn-to-person.tex`'s
  `\section{Open problems (the starred exercises, collected)}` matched the
  `exercises\b` title substring and, being the last such match, was taken
  for the chapter's closing Exercises section — so all **50** correctly
  placed clusters were reported as sitting outside it. Fifty false
  positives is worse than no check, because someone acts on them.
  Selection now scores candidates by exact normalized title first
  (`Exercises`, optionally numbered, optionally "and solutions"), then by
  how many `\pdexercisesfor`/`\pdexercise` clusters the candidate actually
  contains — the grouping the page grammar already defines — and only then
  by position. An exactly-titled section outranks a decoy holding the
  clusters, so clusters parked in "Starred exercises" while the chapter's
  own Exercises section stands empty still fail. The report now names the
  section it judged against, which the misfiring version never did.
  New helpers: `normalize_section_title`, `exercise_cluster_positions`;
  `find_final_exercises_section` takes the cluster positions;
  `find_exercise_clusters` returns `(clusters, exercises_section)`.
- `at_most_one_interlude` could only see interludes that were already
  labelled, and printed a clean `PASS` on `whitepaper/legible-swarm.tex` —
  the chapter with the worst instance of exactly what it checks (Hobbes as
  its spine, Scott as its governing warning, both unlabelled, plus Hume,
  Locke, Pateman, Hirschman and Hayek in §9). Renamed
  `at_most_one_labelled_interlude` and given a fourth status: two or more
  labelled interludes still FAIL and still block, but one or none now
  reports `REVIEW`, never `PASS`, and says what was measured —
  "0 LABELLED interludes … an unlabelled philosophical aside woven into
  ordinary prose is not detectable here and needs a human read". No
  keyword list of philosopher names was added and none should be: that is
  a guess wearing a measurement's clothes. A citation footprint
  (bibliography entries; distinct works cited in the body; how many of
  those are cited from a single section only — `citation_spread`) rides
  along explicitly marked "Hint, not a verdict and not evidence" and can
  never change the floor's status.
- New status `REVIEW` in `floor_status`, counted separately in both
  consolidated reports: a floor whose rule is only partly mechanically
  visible reports what it measured instead of certifying what it cannot
  see. It never blocks `--strict`.
- `tests/test_chapter_lint.py`: 13 new tests — the spawn-to-person decoy,
  scattered mid-body clusters still failing, exact-title precedence over a
  decoy holding clusters, a chapter with no Exercises section at all,
  title-markup normalization, zero/one/two labelled interludes, the hint
  never becoming the verdict, `\pdcite` counting, and REVIEW rows in the
  consolidated summary.
- `examples/chapter1-lint-report.txt` and
  `examples/consolidated-lint-report.txt` regenerated; both are now
  produced with `--repo-root .` so the chapter column stays repo-relative.

## v1.1.0 (2026-09-08)

Six `chapter_lint.py` fixes from PR #10074 review bots (lead-accepted), plus
CI wiring and a consolidated report:

- Strip TeX comments (`(?<!\\)%.*$`, the idiom
  `scripts/harbor-research/check_plate_provenance.py` proved out) <!-- phantom-ok -->
  before every regex pass, in place, preserving newlines so line numbers
  stay correct for free.
- `claims_carry_epistemic_kind`: the tag must sit inside the claim's own
  brace-and-env-balanced body (new `balanced_env_body`), not a fixed
  ±200/400-character window that could borrow a neighboring claim's tag.
- `no_tinted_box_macros`: dead-or-live is settled by parsing
  `whitepaper/figures/pd-pedagogy.tex` itself (which macro names its
  `\AtBeginDocument` block actually re-`\long\def`'s), located by walking
  upward from the chapter's own path rather than a hard-coded absolute
  path — not by whether the chapter's own `\input` line is present.
- New floor `imports_pd_pedagogy_twin`: a chapter must `\input` the
  pedagogy twin outright, independent of whether any legacy macro happens
  to be neutralized.
- `exercises_at_chapter_end` tightened to the chapter's own closing
  `\section{Exercises}` specifically (not merely some section along the
  way that shares the word) and made advisory: the Book's chapters have
  not all been relocated to this rule yet.
- New floor `chapter_opener_and_claim_labeling` (advisory): the first
  `\section` must open with prose or an epigraph macro, not a cold table
  or claim, and every claim-like environment must be tagged.
- Multi-chapter consolidated report (`--table`, or simply more than one
  chapter path) and a default chapter list read from
  `whitepaper/textbook.json` when none is given, mirroring
  `skills/tufte-evidence-design/scripts/margin_lint.py`'s own convention.
- `.github/workflows/library-checks.yml` runs the skill's own unit tests
  and the chapter floors across all eight Book chapters (advisory /
  `continue-on-error` for now: two blocking floors already fail on several
  chapters, pre-dating this change).
- `skills/textbook-craft/tests/test_chapter_lint.py`: unit tests for every
  item above.
- `examples/consolidated-lint-report.txt`: the one-table report CI reads.
  `examples/chapter1-lint-report.txt` regenerated against the chapter's
  current (post-relocation) state.

## v1.0.0 (2026-09-07)

- Initial skill, built from `docs/harbor-research/exposition/TEXTBOOK-CRAFT.md`
  (seed research memo), `READING-FLOW-AUDIT.md`, `HANDOFF-TEXTBOOK.md`,
  `memo-solution-key.md`, `whitepaper/figures/pd-pedagogy.tex`, and
  `skills/harbor-exposition/SKILL.md`, extended with web research (Rudin,
  Mason–Burton–Stacey, Chi self-explanation, Rohrer/Bjork interleaving) and
  the author's public corpus (`github.com/curiositech/some_claude_skills`,
  `corpus/`: Pólya, Lakatos ×2, Hersh, Meadows, Gawande).
- `SKILL.md`: decision tree (which page element does a paragraph need), the
  chapter template summary, exercise ladder, worked-example discipline, page
  grammar table bound to `pd-pedagogy.tex`'s real macro vocabulary, pacing
  rules from the measured reading-flow findings, the four-kind honesty
  ledger, five anti-patterns, and NOT-for boundaries against
  `harbor-exposition`, `harbor-chartwork`, and `latex-whitepaper-engineering`.
- `references/canon.md`, `references/learning-science.md`,
  `references/exercise-design.md`, `references/chapter-template.md`,
  `references/sources.md`.
- `scripts/chapter_lint.py` (stdlib only): parses a `.tex` chapter and reports
  sections, worked examples per section, exercise-cluster placement, claim
  epistemic-kind tagging, interlude count, legacy tinted-box macro
  definitions (aware of `\input{figures/pd-pedagogy}` neutralizing them), and
  chapter-close apparatus, against this skill's floors. Tested against
  `whitepaper/single-writer-kernel.tex` (fails 5/6 floors — a pre-reform
  chapter, captured honestly in `examples/chapter1-lint-report.txt`) and
  spot-checked against a pd-pedagogy-adopted chapter to confirm it correctly
  passes the floors that chapter actually meets.
- `examples/chapter1-lint-report.txt` and `examples/README.md`.
