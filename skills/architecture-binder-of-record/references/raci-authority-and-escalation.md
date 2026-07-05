# RACI, Authority, And Escalation

Use this when you need to know who is Accountable for a specific binder
concern, what the Architect of Record may and may not do unilaterally, or
which of the three escalation tiers a finding belongs to.

Source of truth: `docs/architecture/agent-harbor-technical-binder/16-binder-architect-of-record.md`.

## The RACI split

| Concern | Accountable | Responsible | Consulted | Informed |
| --- | --- | --- | --- | --- |
| Canonical terms | Harbor Architect of Record | Binder editors | Operator, implementers | All agents |
| Cross-chapter contradictions | Harbor Architect of Record | Review agents | Red/white/security/product reviewers | All agents |
| Contingency coverage | Harbor Architect of Record | Domain reviewers | Support, security, product, infra | Operator |
| Shipped/partial/spec status | Harbor Architect of Record | Implementers | PR steward, release steward | Operator |
| Proof gates and owners | Harbor Architect of Record | Chain owners | Test, security, UX, data reviewers | Operator |
| Operator decisions | Operator | Harbor Architect of Record surfaces | Product reviewers | All agents |

Exactly one row has an Accountable owner other than the Architect of Record:
operator decisions. The Architect of Record surfaces those decisions; it does
not make them. Two named ships own adjacent concerns and must not be
duplicated: `steward` owns PR movement, `officer-of-the-watch` owns log/traffic
anomalies. The Architect of Record owns binder truth only.

## Authority — what the role may and may not do

May:

- edit binder chapters and the binder map;
- mark a section `contradictory`, `underspecified`, `target-only`, or
  `implementation-ready`;
- add required proof gates before implementation chains;
- open or update one rolling issue titled `Agent Harbor binder truth log`;
- spawn or request redteam, whitehat, UX, data, security, and implementation
  reviewers;
- block an implementation claim in the binder when no testable acceptance gate
  exists;
- request an operator decision when two plausible product paths conflict.

May not:

- silently decide a product tradeoff that belongs to the operator;
- patch product code as part of the watch cycle;
- merge PRs or answer PR comments unless explicitly acting under the PR
  Steward role;
- call a target design "shipped" without code, tests, artifacts, and runtime
  proof.

The failure mode this boundary exists to prevent is an agent quietly making a
product-scope call (pricing fork, privacy tradeoff, public-harbor governance
rule) and burying it in a chapter edit where the operator never sees it as a
decision.

## Escalation tiers

**Tier 1 — record.** Local inconsistency, a typo that changes meaning, a
missing cross-link, weak wording, or a claim that merely needs evidence.
Write the ledger entry and update the chapter directly. No section gets
blocked.

**Tier 2 — block a section.** A cross-chapter contradiction that would
mislead an implementer, an unowned proof gate, an unsupported shipped/partial
claim, a missing customer class, or a missing failure mode for a
security/privacy/billing path. Mark the section `blocked pending synthesis`
and open or update the rolling truth-log issue. This is the tier
`unresolved-contradiction` and `coverage-axis-incomplete` findings map to.

**Tier 3 — operator decision.** A product fork, a privacy/security tradeoff,
a pricing/account model fork, a public-harbor governance rule, or anything
that changes what the product is. Surface the decision in the rolling issue;
do not resolve it as an agent.

Pick the tier by asking: does this need a person with product authority to
choose between two real paths (Tier 3), does it need the affected section
frozen until it's fixed (Tier 2), or can the ledger entry alone carry it
forward (Tier 1)?

## State surfaces — who sees what

- **Operator-visible ledger**: append-only `pd note` entries prefixed
  `binder-aor-log:`. Every run writes one, including a run that finds
  nothing (ALL QUIET is still a ledger entry — its absence is itself a
  finding for the next run).
- **Working state**: the coverage matrices (customer/deployment, technical
  contingency, architecture consistency) maintained inside the binder chapter
  until a first-class coverage table exists.
- **Signals to other agents**: TTL'd tuples — `agent-harbor:binder-gap`,
  `agent-harbor:binder-contradiction`, `agent-harbor:proof-gate-blocker`,
  `agent-harbor:operator-decision-needed`.
- **Durable evidence**: links to source docs, PRs, commits, transcripts,
  screenshots, test runs, diagrams, review artifacts, and accepted-risk
  records. A claim with no evidence link stays unresolved regardless of how
  confident the prose sounds.
