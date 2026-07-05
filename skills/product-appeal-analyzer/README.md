# Product Appeal Analyzer

Evaluate whether users will *want* a product — not just whether they can use
it. The complement to `ux-friction-analyzer`: friction asks "can they use
it?", appeal asks "do they want it?".

Use this skill when reviewing a landing page, app store listing, or product
page pre-launch; positioning a product against alternatives; or diagnosing
why a low-friction product still isn't converting.

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

A spec that scores `pass: true` still deserves a human sanity check — the
auditor only verifies the numbers and flags the analyst already recorded; it
cannot tell you whether those numbers are honest.
