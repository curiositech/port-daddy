# Agent Identity, Continuity & Reputation

Design (or audit) the chain: memory+checkpoint → continuity → a durable
person (not a spawn) → registered outcomes → reputation (Elo/TrueSkill/
bandit) → a hireable/sellable asset → a market — and know exactly where each
link silently turns to theater.

Use this skill when you need agent identity that survives a process death,
an outcome ledger that reputation can actually key on, a reputation
estimator for backends or agents, or a review of whether an existing design
is Sybil-resistant, oracle-bound, de-biased, and honestly labeled.

## Quick Start

1. Read `SKILL.md` — work the five Decision Points in order; earlier links
   gate later ones (identity gates continuity gates outcomes gates
   reputation gates the market).
2. Load `references/failure-modes-and-defenses.md` for the eight named
   failure modes (Sybil-reset, whitewashing, Goodhart ×2, exploration
   starvation, LLM-judge bias, unstaked sanctions, weak continuity), each
   with its source citation and defense.
3. Fill `templates/output-template.md` for the task at hand, or write a
   design plan matching `schemas/reputation-plan.schema.json` directly.
4. Run `node scripts/reputation_soundness_audit.mjs --input plan.json`.

A design that scores `pass: true` has closed every chain-break this skill
knows how to name. It has *not* proven the underlying work was good — only
that delivery was proven against an oracle on a clock the agent didn't set.
That honest-ceiling caveat belongs in every design this skill produces.
