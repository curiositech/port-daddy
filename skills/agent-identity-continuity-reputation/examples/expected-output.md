# Example Output: Reputation Design Plan + Audit

Scenario: a fleet is standing up reputation for its coding-agent backends.
Identity is daemon-minted (ADR-0040 target state), continuity includes a real
outcome ledger (not just a forwarded note), outcomes close against merged
SHAs and CI runs with sampled adversarial re-opening, TrueSkill is the
estimator with uncertainty exposed, the score is telemetry-only with
predicate gates, a newcomer floor exists, an LLM-as-judge is present and
de-biased, and sanctions are staked and graduated. This is
`examples/sample-input.json` verbatim.

```json
{
  "identityNonForgeable": true,
  "continuityPersists": {
    "memory": true,
    "checkpoint": true,
    "outcomeLedger": true
  },
  "outcomesCloseAgainstOracle": true,
  "sampledAdversarialAuditor": true,
  "estimator": "trueskill",
  "representsUncertainty": true,
  "scoreIsTelemetryGatesArePredicates": true,
  "newcomerPolicy": true,
  "judge": {
    "present": true,
    "deBiased": true
  },
  "sanctionsStakedGraduated": true,
  "notes": "Daemon-minted agent id bound to a signing key (ADR-0040 target state). Continuity = episodic-memory-algorithms stream + checkpoint snapshot + an append-only outcome ledger keyed on merged SHAs and passing CI run ids. A sampled adversarial auditor re-opens 10% of cleared outcomes weekly, risk-weighted toward high-spend tasks. TrueSkill estimator per (role, backend) with variance exposed. Score surfaced as telemetry only; routing/spend gates check predicate counts (clean exits, no overdue obligations), not the raw score. Newcomer floor: full task eligibility, reduced payout ceiling until 10 clean exits accrue. An LLM-as-judge participates in pairwise PR comparisons, blinded and order-swapped, and never judges its own model family. Sanction ladder: first audit failure = payout clawback; repeat = suspension with staked bond forfeiture."
}
```

Running it through the auditor confirms every chain-break is closed:

```
$ node scripts/reputation_soundness_audit.mjs --input examples/sample-input.json
{
  "pass": true,
  "findings": [],
  "recommendations": [
    "Plan is structurally sound against every named chain-break. Spot-check that the honest-ceiling caveat is stated: this proves delivery against an oracle on a clock the agent did not set, not that the work was good."
  ]
}
```

## Contrast: a plan with a self-asserted identity and note-only continuity

The single most common overclaim in practice — the agent picks its own id,
and "resurrection" only forwards a text note with no outcome ledger:

```json
{
  "identityNonForgeable": false,
  "continuityPersists": { "memory": true, "checkpoint": false, "outcomeLedger": false },
  "outcomesCloseAgainstOracle": false,
  "sampledAdversarialAuditor": false,
  "estimator": "elo",
  "representsUncertainty": false,
  "scoreIsTelemetryGatesArePredicates": false,
  "newcomerPolicy": false,
  "judge": { "present": true, "deBiased": false },
  "sanctionsStakedGraduated": false
}
```

```
$ node scripts/reputation_soundness_audit.mjs --input weak-plan.json
{
  "pass": false,
  "findings": [
    { "id": "forgeable-self-asserted-identity", "severity": "critical", "message": "STOP — identity is forgeable/self-asserted. ..." },
    { "id": "weak-continuity-note-only", "severity": "high", "message": "Weak continuity: outcomeLedger is false. ..." },
    { "id": "self-closed-outcomes-no-oracle", "severity": "high", "message": "Self-closed outcomes: outcomes do not close against an oracle ..." },
    { "id": "no-adversarial-reopen", "severity": "high", "message": "No sampled adversarial auditor: ..." },
    { "id": "estimator-without-uncertainty", "severity": "medium", "message": "Estimator \"elo\" does not represent uncertainty: ..." },
    { "id": "reputation-wired-to-gate", "severity": "high", "message": "Reputation score is wired directly to a kill/spend/routing gate ..." },
    { "id": "no-newcomer-policy", "severity": "medium", "message": "No newcomer policy: ..." },
    { "id": "undebiased-judge", "severity": "medium", "message": "An LLM-as-judge is in the reputation loop and is not de-biased: ..." },
    { "id": "unstaked-sanctions", "severity": "medium", "message": "Sanctions are not staked/graduated: ..." }
  ],
  "recommendations": [ "... nine concrete, one per finding ..." ]
}
```

What makes the first plan trustworthy and the second theater, in reviewer
terms: the first plan's identity cannot be re-picked by the agent it
describes, its continuity has a real outcome ledger (not just a forwarded
note), its outcomes close against oracles with adversarial spot-checks, its
estimator represents uncertainty so new backends aren't starved, its score is
telemetry rather than a gate, and every remaining defense (newcomer floor,
judge de-biasing, staked sanctions) is present. The second plan fails at the
very first gate — a forgeable identity — which is why the auditor marks it
`critical` and stops trusting anything built on top of it, exactly as the
Decision Points in `SKILL.md` say it should.
