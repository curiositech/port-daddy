# Product Appeal Analyzer

Evaluate whether someone will *want* this — not just whether they can use it.
The complement to `ux-friction-analyzer`: friction asks "can they get through
it?", appeal asks "do they want to?". The two are readouts of one random-surfer
chain — friction is the terms that raise the abandon hazard, appeal is the
terms that lower it.

Use this skill when reviewing a landing page, app store listing, or product
page pre-launch; when evaluating a **paper, monograph, textbook, or
whitepaper**; when reviewing a **wireframe**; when positioning against
alternatives; or when diagnosing why a low-friction thing still isn't
converting — or still isn't being finished.

## Quick Start

1. Read `SKILL.md` for the Desirability Triangle, the 5-Second Test, and the
   four anti-patterns (Feature Soup Headline, Screenshot Hero, Trust Ladder
   Violation, Identity Mismatch).
2. Run the Analysis Process (Steps 1-4 in `SKILL.md`): identify personas,
   score the Triangle per persona, map objections, generate recommendations.
3. For a live URL, seed the process with
   `python scripts/appeal_scorer.py <url> --template`, then fill in the
   scores by hand.
4. Once scored, turn the analysis into a structured spec matching
   `schemas/appeal-spec.schema.json` (see `templates/output-template.md`)
   and run `node scripts/appeal_audit.mjs --input spec.json` to deterministically
   check it against this skill's own gates.
5. Load `references/scoring-templates.md`, `references/trust-ladder.md`,
   `references/identity-signals.md`, or `references/objection-catalog.md`
   for deep dives on any step.

## For a technical document or book

Read `references/technical-document-appeal.md` first. The Desirability Triangle
grows a fourth vertex — **Return on Effort** — because a monograph's price is
forty hours rather than thirty seconds, and nothing in the triangle prices
effort. You also swap the 5-Second Test for the **30-Second Shelf Test**.

Then fill in the `technicalDocument` block of the spec (shelf test, return on
effort, declared audience and prerequisites, figure self-containment,
reproducibility, typographic craft) and, if the book prints a Reader's Map, its
`readerMap.paths` — matching each scored persona to the route the document
prints for it. `examples/technical-book-spec.json` exercises every gate.

Paste `payoffReachProbability` and `completion` from `ux-friction-analyzer`'s
`surfer_model.mjs` into the `surfer` block; appeal cannot be fixed downstream
of where people stop.

## For a wireframe

Read `references/surface-appeal-adapters.md`. One rule governs everything:
**a wireframe can fail appeal but cannot pass it.** Set
`surfaceKind: "wireframe"` and score `null` for what is not there to be seen.

---

A spec that scores `pass: true` still deserves a human sanity check — the
auditor only verifies the numbers and flags the analyst already recorded; it
cannot tell you whether those numbers are honest.
