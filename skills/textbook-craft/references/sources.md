# Sources

Every claim in this skill is tiered exactly as the seed memo tiered it. Carry
the tier forward whenever you cite a rule from this skill in a review comment
or a PR description — do not launder a Tier C claim into an unqualified one.

- **Tier A** — read in full for the seed memo or by this skill's own research pass.
- **Tier B** — verified online (a publisher page, a front-matter PDF, a paper, a
  reproducible search result); not held in hand page-by-page.
- **Tier C** — memory or synthesis; flagged `[unverified]` inline everywhere it
  is used. Never promoted silently.

This skill adds no source the seed memo or this pass could not point at. Where
a fact could not be verified from this environment, it is marked `[unverified]`
in `references/canon.md` and `references/learning-science.md` and is not
enforced as a floor in `scripts/chapter_lint.py` — only independently verified,
repeatable structural facts (section/example/exercise counts, box vocabulary)
are checked mechanically.

## Primary seed (Tier A, read in full for this skill)

- `docs/harbor-research/exposition/TEXTBOOK-CRAFT.md` — the research memo this
  skill is built from (Halmos read page-by-page; Axler, SICP, Feynman, Knuth,
  Spivak, Strang, Sipser, CLRS, Pierce, MacKay, Osborne–Rubinstein and a dozen
  more economics/game-theory texts at Tier B; Lakatos and Pólya at Tier B;
  Lamport and Tao read in full; two specimen papers, Lizzeri 1994 and van der
  Meyden 2007, read section by section). Its own Tier A/B/C markings are
  preserved verbatim in `references/canon.md`.
- `docs/harbor-research/exposition/READING-FLOW-AUDIT.md` — the measured
  reading-flow findings (F1–F7) on the Book's actual rendered pages: kinds per
  page, back-references per page, time-to-first-checkable-fact, and the eight
  reader archetypes (A1–A8). `scripts/chapter_lint.py`'s floors and the page
  grammar in `SKILL.md` are chosen so a chapter that passes them would not
  reproduce F1 (exercises interrupting the argument), F2 (five tinted content
  kinds), F3/F5 (long runs with nothing to look at) or F7 (back matter losing
  its running head).
- `docs/harbor-research/exposition/HANDOFF-TEXTBOOK.md` — the settled design
  contracts (page grammar, three editions, `skills/harbor-chartwork` as the
  figure authority) and the standing instruction that thin material is
  developed, not decorated.
- `docs/harbor-research/exposition/memo-solution-key.md` — *The Harbor After
  the Harbor*'s exercise solution key, read for its own two governing rules
  (quoted in `references/exercise-design.md` and in `SKILL.md`'s honesty
  ledger): repair a false premise instead of answering it as asked, and give
  open problems a defensible obligation rather than a fictional closed form.
- `whitepaper/figures/pd-pedagogy.tex` (on `main` since the Book landed; it was
  read from `wave-16/figure-gates` when this skill was first written) — the
  actual macro vocabulary
  this skill's page-grammar section and `chapter_lint.py`'s claim/example/
  exercise detection are built against: `pdclaim` (kinds `Theorem`, `Design
  invariant`, `Model-checked property`, `Empirical hypothesis`), `pdboundary`
  ("Where this stops"), `pdexample` ("Numbers by hand"), `pdrecitation`
  ("Recall"), `pdexercise` (kinds `Check`/`Trace`/`Open`, ratings 1–3 stars),
  `pdsession` ("At the terminal"), `pdassurance` (modes `Observed`,
  `Coordinated`, `Brokered`, `Confined`, `Attested`), `pdexercisesfor` /
  `pdexercisepointer(one)` (chapter-end exercise blocks with margin pointers),
  and the retyped legacy boxes `\keyidea`, `\pitfall`, `\scene`, `\xrefbox`,
  `\pullquote` — all "a run-in or margin head and plain prose, no fill."
- `skills/harbor-exposition/SKILL.md` — the seven-moves-plus-two-rails house
  style for *results write-ups* (papers, execution reports, README explainers).
  This skill is downstream of it and does not duplicate it: harbor-exposition
  governs one self-contained argument; `textbook-craft` governs a chapter of a
  book that must also open, pace, exercise, and hand off across many pages. See
  `SKILL.md`'s "Relationship to `harbor-exposition`" for the exact boundary.
- `whitepaper/single-writer-kernel.tex` — the chapter this skill's
  `scripts/chapter_lint.py` is tested against. It predates the Wave 12 page
  grammar: it uses its own local tinted-box macros (`\keyidea`, `\pitfall`,
  `\exercises{...}`, all `tikzpicture` nodes with `fill=hhsand!NN`) rather than
  `pd-pedagogy.tex`'s typographic ones, and its `\exercises{...}` blocks sit
  after nine different subsections rather than at chapter end. Both facts are
  exactly what `chapter_lint.py` is built to catch; see its `--help` and the
  worked report in `examples/`.

## Canon (Tiers A/B/C as marked in `references/canon.md`)

Feynman, *The Feynman Lectures on Physics* Vol. I; Abelson & Sussman, *SICP*
2nd ed.; Knuth, *The Art of Computer Programming* Vol. 1 and *Concrete
Mathematics* (with Graham and Patashnik); Axler, *Linear Algebra Done Right*
3rd/4th ed.; Spivak, *Calculus* 3rd ed.; Strang, *Introduction to Linear
Algebra* 6th ed.; Sipser, *Introduction to the Theory of Computation*; Cormen,
Leiserson, Rivest, Stein, *Introduction to Algorithms*; Pierce, *Types and
Programming Languages*; MacKay, *Information Theory, Inference, and Learning
Algorithms*; Rudin, *Principles of Mathematical Analysis* (cited as the
deductivist counter-example, not the model); Halmos, "How to Write
Mathematics" (*L'Enseignement Mathématique* 16, 1970); Knuth, Larrabee,
Roberts, *Mathematical Writing* (MAA Notes 14, 1989); Pólya, *How to Solve It*
(1945); Lakatos, *Proofs and Refutations* (1976); Hersh, *What Is Mathematics,
Really?* (1997); Mason, Burton, Stacey, *Thinking Mathematically* (1982/2010).

## Learning science (Tiers A/B as marked in `references/learning-science.md`)

Sweller & Cooper 1985 (worked-example effect); Kirschner, Sweller, Clark 2006
(guided instruction); Kalyuga, Ayres, Chandler, Sweller 2003 (expertise
reversal); Renkl & Atkinson 2003 (fading); Chi, Bassok, Lewis, Reimann, Glaser
1989 and Chi & VanLehn 1994 (self-explanation); Roediger & Karpicke 2006,
Karpicke & Blunt 2011, Dunlosky et al. 2013 (retrieval practice); Rohrer &
Taylor 2007, Rohrer & Hartwig 2020, Bjork & Bjork (desirable difficulties,
interleaving, spacing); Fyfe, McNeil, Son, Goldstone 2014 (concreteness
fading); Kaminski, Sloutsky, Heckler 2008 and its 2020 replication.

## Tufte

Tufte, *Beautiful Evidence* (2006); the Tufte-LaTeX `sample-book.tex`
convention (asymmetric page, wide margin column, sidenotes over footnotes) —
the same convention `HANDOFF-TEXTBOOK.md` §3 states the Book adopted (7×10 in,
one-sided, 4.5 in column, 1.3 in margin column always on the right).

## The external corpus: `curiositech/some_claude_skills`

Every bare `corpus/...` path below names a directory inside the **author's
separate, public GitHub repository** `curiositech/some_claude_skills` — it is
an external, read-only reference this skill was written against, not a path
that exists (or should ever exist) inside *this* repository. Do not go
looking for `corpus/` here; follow the paths on GitHub at
`github.com/curiositech/some_claude_skills`.

Fetched over HTTPS from `raw.githubusercontent.com` and `github.com` (tree/blob
views; the API host returned 403 to this session's unauthenticated egress, so
the tree/blob HTML views were used for listings and `raw.githubusercontent.com`
for file bodies) on 2026-09-07. Directory listing at
`curiositech/some_claude_skills`'s `corpus/`: `books/`, `books_retry/`,
`books_skill_draft/`, `for_erik/`, `meta-skills-experiment/`, `output/`,
`scripts/`, plus `COMPLETION_REPORT.md`, `QUICK_START.md`, `README.md`,
`README_SKILL_GENERATION.md`, `SKILL_DRAFT_RESUMPTION_PLAN.md`. Per that
repo's `corpus/README.md`, the pipeline is a three-pass Haiku→Sonnet→Sonnet
distillation of books in `corpus/books/` into `corpus/output/*_knowledge_map.json`
and, sometimes, a draft `*_SKILL.md`.

Files on textbook craft, exposition, Pólya, Lakatos, Hersh, Meadows, or Gawande
found and used, each cited by its path within `curiositech/some_claude_skills`
where it informed this skill:

- `corpus/books/George_Polya_How_To_Solve_It_.pdf` and
  `corpus/output/Polya_G._How_to_solve_it__1957_pass1_extractions.json` /
  `..._knowledge_map.json` — present in the corpus; the specific knowledge-map
  fetch attempted for this skill returned an empty extraction (the pipeline's
  own output, not a fetch failure — recorded honestly rather than papered
  over). Pólya's four phases used in this skill (`references/exercise-design.md`)
  are cited from the seed memo's own Tier B reading of *How to Solve It*, not
  from this corpus fetch.
- `corpus/books/Lakatos.pdf` and `corpus/books/lakatos2.pdf`, distilled at
  `corpus/output/Lakatos_knowledge_map.json` and
  `corpus/output/lakatos2_knowledge_map.json` — fetched and read for this
  skill; supplies the monster-barring/local-vs-global-counterexample
  vocabulary in `references/exercise-design.md` and the anti-pattern in
  `SKILL.md` §Anti-Patterns.
- `corpus/books/what_is_mathematis_really-reuben_hersh.pdf`, distilled at
  `corpus/output/what_is_mathematis_really-reuben_hersh_knowledge_map.json` —
  fetched and read for this skill; supplies the front/back-of-mathematics
  distinction used in `SKILL.md`'s decision tree ("worked example before
  definition" is showing the reader the back before the front) and the two
  quotes in `references/canon.md` §Hersh.
- `corpus/books/Meadows-2008.-Thinking-in-Systems.pdf`, distilled at
  `corpus/output/Meadows-2008.-Thinking-in-Systems_knowledge_map.json` —
  fetched and read for this skill; the leverage-points ranking (parameters <
  information flows < rules < goals < paradigms) is the model for
  `references/learning-science.md`'s note on why a chapter's boundary section
  is higher-leverage editing than its prose, and for the anti-pattern
  "estimator catalogs" (a parameter-level fix papering over a structural one).
- `corpus/books/AtulGawandeTheChecklistManifestoHowToGetThingsRight2010.pdf`,
  distilled at
  `corpus/output/AtulGawandeTheChecklistManifestoHowToGetThingsRight2010_knowledge_map.json`
  — fetched and read for this skill; the killer-items/READ-DO vs. DO-CONFIRM
  distinction is the direct model for `scripts/chapter_lint.py`'s floors
  themselves (a short, five-to-nine-item, expert-facing check that catches
  what a rushed author skips under deadline, not a comprehensive how-to) and
  for the exercise-rating discipline in `references/exercise-design.md`.

Not fetched (out of scope for this pass, or no textbook-craft content found by
directory name), all still within `curiositech/some_claude_skills`:
`corpus/books/clean_code.md`, `design_patterns.md`,
`philosophy_of_software_design.md`, `passionate_programmer.md`,
`data_science_for_business.md`, `mythical-man-month.pdf`, `7_principles_of_public_speaking.md`,
`Gödel Escher Bach_ An Eternal Golden Braid.pdf` (already covered directly from
the seed memo's own Tier B reading), `Seeing Like a State.mhtml`, `Poor
Charlie's Almanack...mhtml`, `2015.101543.The-Sociological-Imagination_text.pdf`,
`thinking-in-betspdf.pages`, and the unlabeled `0551113.pdf` /
`4bb8d08a9b309df7d86e62ec4056ceef.pdf`; `corpus/for_erik/`,
`corpus/meta-skills-experiment/`, `corpus/books_retry/`,
`corpus/books_skill_draft/` were not opened.

## What this skill declines to claim

No page number is cited for Rudin, Polya's corpus-side extraction, or any
Tier-C item in `references/canon.md` beyond what the seed memo itself already
verified. Where this pass's own search returned a quote it could not
independently confirm against a primary source (one purported Rudin preface
line), it is omitted from `references/canon.md` rather than printed
`[unverified]` with confidence it does not deserve — Halmos's rule ("Confess
immediately") applied to research provenance, not only to book chapters.
