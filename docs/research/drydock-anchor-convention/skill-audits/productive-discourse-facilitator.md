# Skill audit — `productive-discourse-facilitator`

**Independent read-only audit · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Verdict

**Supplant in place.** Overall semantic score: **3.8/10 (D)**. The bundle has
useful dialogue/debate/deliberation distinctions and warns against premature
synthesis, but broad activation, unsupported clinical material, consensus
incentives, absent termination, and self-certifying quality gates are too
entangled for incremental repair.

| Dimension | Score / 10 | Finding |
|---|---:|---|
| Frontmatter / activation | 3 | No description-level NOT clause; broad conflict and recovery trigger. |
| Domain expertise | 5 | Useful mode distinction; weak on coercion, deception, epistemic measures, termination. |
| Progressive disclosure | 8 | Lean core and conditionally routed references. |
| Anti-patterns | 4 | Named failures but no structured detection or executable findings. |
| Visuals | 2 | Generic boilerplate diagram, not a discourse protocol. |
| Self-containment | 3 | Missing delegated skills and orphan bundle files escape the passing checker. |
| Citation truth | 1 | Psychological, neurological, recovery, and outcome claims lack primary support. |
| Executable validation | 0 | No schema, fixtures, scorer, or negative controls. |
| Changelog | 2 | No semantic versions, behavioral rationale, or validation evidence. |
| Least privilege | 2 | Overlaps coordinator/steelman/bad-faith roles; unnecessary write access. |

## Critical findings

1. **Power imbalance is routed into facilitation.** Equal turns do not repair
   coercion. The same bundle later says not to use it when one party holds clear
   decision power, producing contradictory safety guidance.
2. **Clinical authority activates from the catalog.** “Couples in recovery,”
   trauma, nervous-system, dopamine, heart-rate, craving, and mandatory-pause
   claims lack appropriate sourcing and belong outside this general skill.
3. **The process optimizes synthesis more reliably than truth.** Consensus
   ranking and “one sentence both would sign” can create agreement theater. No
   claim/evidence map, confidence update, crux, falsifier, or source-quality
   distinction is required.
4. **Steelmanning is a checkbox.** Holder approval alone can be strategically
   accepted or indefinitely withheld. No typed certificate records premises,
   evidence, implications, strongest objection, change condition, and repairs.
5. **No bounded-round or terminal constitution exists.** The main loop can run
   forever and has no terminal states for refusal, bad faith, dissent, evidence
   insufficiency, or safety.
6. **Deception handling is lazy-loaded.** Willingness to update, disclose
   authority, preserve the opponent's claim, or name change conditions is not an
   intake gate.
7. **Orchestration is overclaimed.** Suite selection belongs to a discourse
   coordinator; argument reconstruction and repeated-rhetoric analysis belong
   to dedicated skills.

## False-green validator evidence

- Structural validation passes while warning about the missing NOT boundary.
- Self-containment passes because it checks literal links, not missing delegated
  skills.
- Mermaid validation proves syntax for a domain-irrelevant diagram.
- The stale scorecard says validator passed even though bundle indexing fails.
- There are no fixtures capable of falsifying coercion, consensus theater,
  weak steelmanning, or endless looping.

## Claims to delete or narrow

- Delete the couples/recovery mode and universal clinical thresholds.
- Replace unequal-power “Dialogue only” with out-of-scope/safety redirection.
- State that equal time is presentation symmetry, not power or epistemic parity.
- Replace shared-signature closure with separate assent, dissent, and non-assent.
- Delete “debate always clarifies,” “people rarely fight over values,” “both are
  trying,” and any unsupported 90-percent opening claim.
- Replace outcome neutrality with procedural impartiality and explicit non-
  neutrality about fabrication, coercion, safety, and protocol violations.

## Replacement contract

> Facilitates bounded, consent-based discourse among peers by selecting
> dialogue, debate, or deliberation; enforcing reciprocal steelmans; preserving
> dissent; and terminating on bad faith, coercion, or exhausted rounds. Use for
> structured multi-party conversations with roughly equal authority. NOT for
> therapy, recovery counseling, abuse or coercive control, crisis support, legal
> or HR mediation, argument analysis, or discourse-suite orchestration.

Default tools become `Read,Grep,Glob`.

## Required protocol

```text
INTAKE
→ SAFETY_AND_AUTHORITY_GATE
→ MODE_CONSENT
→ CLAIM_MAP
→ STEELMAN_ROUND (maximum two)
→ TEST_OR_DELIBERATE
→ TERMINAL
```

Closed terminals: `SYNTHESIS_ACCEPTED`, `DISSENT_RECORDED`,
`DECISION_ESCALATED`, `EVIDENCE_INSUFFICIENT`, `PAUSED_FOR_SAFETY`,
`TERMINATED_BAD_FAITH`, and `OUT_OF_SCOPE`.

Each steelman certificate records claim, premises, evidence, values,
implications, strongest objection, falsifier/change condition, opponent
restatement, holder verdict, correction, and round. Two failed repairs preserve
the representation dispute and terminate.

## Required bundle

- closed discourse-session schema;
- protocol validator over structured fields, never keyword-inferred intent;
- valid dissent example;
- negative fixtures for coercion, weak steelman, missing dissent, excessive
  rounds, missing terminal, and self-certified synthesis;
- at least six positive and six negative activation cases;
- real state and admission diagrams;
- primary-source claim ledger;
- `v2.0.0` breaking changelog;
- no retained clinical or consensus-oriented legacy mode.
