# UX Friction Analyzer — Changelog

## v1.2.0 (2026-09-15)

Extends the skill from live web flows to **any surface a person has to get
through**: wireframes, PDF documents, and LaTeX books.

- **Random-surfer reader model** (`scripts/surfer_model.mjs`,
  `references/random-surfer-reader.md`). Generalises PageRank's random surfer to
  reading: four moves (continue, regress, teleport, abandon) over an absorbing
  Markov chain. Exact linear algebra on the fundamental matrix, not a sampled
  simulation. Produces attention mass, per-node reach probability, expected
  regressions, the median exit node, and time-to-first-insight computed via a
  Doob h-transform of the chain conditioned on reaching the payoff.
- **Reader maps** (`references/reader-maps.md`). A book's printed "Reader's
  Map" — *practitioners read 1, 3, 7, 9* — is encoded as `readerPaths` and each
  route evaluated as its own surface. Catches the **broken-by-map
  prerequisite**: a route that skips the chapter introducing a concept a later
  chapter on that route needs, which the linear reading order hides completely.
  Routes carry their own personas, reading modes, and patience budgets.
- **Gestalt operators** (`references/gestalt-operators.md`). The skill claimed
  Gestalt in its description and contained none. Now each principle has a
  detection rule, a measurement, and a fix, plus the cue-conflict procedure and
  the scoring guide for a node's `gestalt` block. Gestalt grouping is the
  transition prior in the surfer model.
- **Comprehension debt** (`references/comprehension-debt.md`). Dangling
  prerequisites, forward references, notation working set, definition distance,
  entropy cliffs, and the six-level **introduction ladder** (named, defined,
  motivated, exemplified, contrasted).
- **Reading models** (`references/reading-models.md`). Scanpath patterns,
  serial position, reading-rate tables for estimating `costSeconds`, and reader
  modes as reading occasions mapped to Keshav's three-pass method.
- **Surface adapters** (`references/surface-adapters.md`). How to encode a
  wireframe, PDF, or LaTeX book — and an honesty table of what each surface
  *cannot* tell you.
- **LaTeX skeleton builder** (`scripts/latex_skeleton.mjs`). Builds most of a
  book's graph from source: sections, word counts, float and equation counts,
  and the author's own `\label`/`\ref` cross-reference graph, so definition
  distance and forward references fall out before you read a word. `payoff` and
  `hook` are deliberately left at 0 so an unfilled skeleton reads as unfilled.
- Three new failure modes in `SKILL.md`: Comprehension Debt Cascade, Entropy
  Cliff, Buried Payoff.
- New `schemas/surface-graph.schema.json`, `examples/surfer-wireframe.json`
  (passes), `examples/surfer-latex-book.json` (fails, with two reader-map
  routes).
- Model constants are documented as **priors, not measurements**, with a
  calibration section and an explicit list of where the model is knowingly
  wrong. Covered by `tests/unit/surfer-model.test.js`.

## v1.1.0 (2026-07-03)

- Upgraded to the agentic-family bundle standard: `metadata.provenance`,
  `metadata.pairs-with`, and `metadata.io-contract` added to frontmatter.
- Added deterministic `scripts/friction_audit.mjs` (`auditFrictionFlow`)
  covering all 5 failure modes plus the mobile/touch/feedback quality gates,
  with `schemas/flow-audit.schema.json` and a verified `examples/sample-input.json`.
- Added `README.md`, `agents/openai.yaml`, `templates/output-template.md`,
  and `examples/expected-output.md`.
- Split the two worked examples into `references/worked-examples.md` and the
  full Quality Gates checklist into `references/quality-gates.md` to keep
  `SKILL.md` focused on the decision matrix, decision tree, and failure
  modes used on every audit.

## v1.0.0

- Initial skill creation (SKILL.md only): cognitive-load/ADHD decision
  matrix, primary decision tree, friction-vs-feature trade-offs, 5 failure
  modes, two worked examples, quality gates, NOT-FOR boundaries.
