# Changelog

All notable changes to `port-daddy-expository-writer`.

## [0.2.0] — 2026-08-31

- Replaced the machine-private voice-memory dependency with the reviewed,
  portable `references/voice-references.md` bundle.
- Updated the skill, README, agent prompts, examples, and scorecard so the skill
  can be installed and validated without Erich's home-directory state.
- Registered the skill as a product-specific exposition adapter in the
  whitepaper corpus manifest; it may explain the research, but it is not a
  canonical source for research claims.

## [0.1.0] — 2026-05-20

Initial structure.

- `SKILL.md` — voice rules (the seven tells, anti-pattern examples for each),
  pedagogical moves (named-then-defined, cathedral build, "the trick" reveals,
  syntax-then-translation, sidenotes), structure decision tree (one-pager →
  multi-section → multi-page tutorial), quality gates, anti-patterns, where to
  apply / where not to apply.
- `agents/expositor-explainer.md` — main drafting persona; patient peer-addressing.
- `agents/expositor-voice-editor.md` — second-pass voice audit persona.
- `agents/expositor-fact-checker.md` — third-pass claim-against-paper audit persona.
- `references/voice-references.md` — verbatim user_voice_website quotes + four
  operator-aligned example paragraphs (ProVerif, TLA+, Kani, Pareto dominance).
- `references/verifier-cheat-sheet.md` — one-paragraph "you reach for this when…"
  treatment of ProVerif, Tamarin, TLA+/TLC, Apalache, Spin, Kani, AFL++/libFuzzer,
  KLEE, Z3, CVC5, Hypothesis/fast-check/proptest, Jepsen.
- `references/analogy-toolkit.md` — fifteen pre-vetted analogies with
  "use when / don't use when / provenance" framing.
- `scripts/audit-voice.sh` — banned-phrase grep with exception-comment support.
- `scripts/count-analogies.sh` — heuristic analogy-density signal, threshold ≥1 per
  500 words.
- `examples/worked-rewrite.md` — three before/after rewrites from
  `agent-transactions-whitepaper.tex §sec:youle`, annotated with which tells fired.
- `examples/analogy-bank.md` — twelve workhorse analogies sized for drop-in use.
- `README.md` — one-screen orientation.
- `affordance-scorecard.json` — structural metadata for the skill registry.

### Pairs with

- `port-daddy-marketing-copy` (one register up: marketing is quieter, expository is the cathedral)
- `port-daddy-agent-skill` (canonical PD coordination conventions)
- `redteam-review` (its computational-tooling reference is the deeper guide to verifier choice)
- `proverif-tamarin-protocol-modeling` (the *how to write the .pv file* skill;
  this skill explains the result to a reader)
- `tlaplus-practitioner` (analogous for TLA+)
- `knot-theory-educator` (the structural exemplar for visual-pedagogy skills)

### Operator-stated rules honored

- No keyword-based NLP — the audit script greps for *exact* banned phrases (structured field),
  not for semantic intent classification.
- No tiny fonts — the skill prescribes Tufte-sidenote density but does not specify font
  sizes; that lives in the website's design tokens.
- Voice rules link to the canonical `user_voice_website.md` rather than duplicating.
- All worked-rewrite content sourced from real paper text, not invented.
