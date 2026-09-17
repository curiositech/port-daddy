# Skill Audit Baseline

Status: structural inventory at exact anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`

This is triage, not a quality verdict. A changelog, reference, script, or test
count does not prove correctness. Zeroes identify missing assurance surfaces;
high counts may still contain weak or stale material.

| Skill | SKILL.md lines | Changelog | References | Scripts | Evals/tests |
|---|---:|:---:|---:|---:|---:|
| `drydock-program-architecture` | 369 | yes | 9 | 4 | 1 |
| `sandboxed-adversarial-test-harness` | 395 | yes | 8 | 1 | 1 |
| `provable-action-adjudicator` | 181 | yes | 5 | 0 | 0 |
| `agentic-zero-trust-security` | 295 | no | 0 | 0 | 0 |
| `circuit-breakers-and-retries` | 373 | yes | 0 | 1 | 0 |
| `runtime-verification-for-agents` | 408 | no | 0 | 0 | 1 |
| `agent-work-receipt-designer` | 180 | yes | 2 | 1 | 0 |
| `focus-receipt-proof-gate` | 160 | yes | 2 | 1 | 0 |
| `cryptoeconomic-protocol-security` | 459 | yes | 1 | 0 | 1 |
| `agent-resurrection-and-body-continuity` | 313 | yes | 2 | 1 | 1 |
| `agent-identity-continuity-reputation` | 229 | yes | 1 | 1 | 0 |
| `agent-context-partitioner` | 746 | no | 2 | 0 | 0 |
| `sqlite-durable-agent-state` | 157 | yes | 2 | 1 | 0 |
| `db-retention-and-compaction` | 214 | yes | 2 | 1 | 0 |
| `context-economics-for-agent-swarms` | 355 | yes | 1 | 1 | 1 |
| `swarm-invocation-designer` | 165 | yes | 2 | 1 | 0 |
| `agent-conversation-protocols` | 236 | no | 0 | 0 | 0 |
| `multi-agent-coordination` | 434 | no | 0 | 0 | 0 |
| `fleet-event-spawn-trust` | 204 | no | 0 | 0 | 0 |
| `hypertree-planning` | 249 | no | 7 | 0 | 0 |
| `pilot-hypertree-execution` | 295 | yes | 0 | 0 | 0 |
| `agent-labor-pricing-function` | 165 | yes | 2 | 1 | 0 |
| `mechanism-design-for-agent-labor` | 539 | no | 0 | 0 | 1 |
| `three-sided-agent-labor-market` | 281 | no | 1 | 0 | 0 |
| `game-theoretic-agent-incentives` | 427 | no | 0 | 0 | 1 |
| `operator-surface-authority-designer` | 174 | yes | 2 | 1 | 0 |
| `legibility-for-agentic-systems` | 262 | no | 0 | 0 | 0 |
| `kieras-goms-for-task-analysis` | 247 | no | 6 | 0 | 0 |
| `tufte-evidence-design` | 217 | yes | 5 | 3 | 0 |
| `agent-control-command-contract` | 168 | yes | 2 | 1 | 0 |
| `human-gate-designer` | 170 | no | 0 | 0 | 0 |
| `agentic-coding-product-research` | 154 | yes | 2 | 1 | 0 |
| `agentic-coding-ux-designer` | 179 | yes | 2 | 1 | 0 |
| `product-reality-reviewer` | 155 | yes | 2 | 1 | 0 |
| `product-roadmap-focus` | 350 | no | 1 | 0 | 0 |
| `product-appeal-analyzer` | 579 | yes | 6 | 2 | 0 |

## Immediate structural risks

1. `agent-context-partitioner` is 746 lines, has no changelog, and exposes
   algorithms without an executable evaluation contract. It violates the skill
   architecture's progressive-disclosure target.
2. `mechanism-design-for-agent-labor` and `product-appeal-analyzer` also exceed
   500 lines. The first lacks a changelog and support bundle.
3. Several authority-critical skills have no activation suite: zero-trust,
   action adjudication, spawn trust, conversation, coordination, hypertree
   planning, human gates, and operator legibility.
4. `provable-action-adjudicator` has references but no executable schema,
   script, or evaluation fixture; its title can overstate what framework-level
   interception proves.
5. A missing changelog on a governing skill makes later agents unable to tell
   whether a changed rule is deliberate, stale, or accidental.

## Update gate

No skill is rewritten merely because its table row looks sparse. Each update
requires:

- a convention finding shared by at least two independent papers or one paper
  plus a reality check;
- a precise activation and NOT-for boundary;
- a concrete failure the change prevents;
- five positive and five negative activation cases;
- no phantom local references;
- an executable validator or a documented reason one cannot exist; and
- a SemVer changelog entry.

## Skill-architect validator readback

The local `skill-architect` structural validator was run against the eight
canonical repo skills explicitly selected for this convention. This is a
linting receipt, not a semantic quality verdict.

| Skill | Result | Exact structural findings |
|---|---|---|
| `provable-action-adjudicator` | pass with warnings | Missing `NOT for` clause; runtime-ignored top-level `version`, `author`, `tags`, and `pairs-with`; no metadata tags. |
| `swarm-invocation-designer` | pass | No structural finding; semantic controller/gather/retry review remains required. |
| `agent-context-partitioner` | **fail** | 747 lines exceeds 500-line limit; `io-contract` is outside `metadata`; no changelog. |
| `cryptoeconomic-protocol-security` | pass with warning | 460 lines approaches the 500-line limit. |
| `manager-driven-team-orchestrator` | pass | No structural finding; manager-authority and dissent-preservation review remains required. |
| `productive-discourse-facilitator` | pass with warning | Missing `NOT for` clause. |
| `steel-man-argument` | pass with warning | Missing `NOT for` clause. |
| `agent-conversation-protocols` | pass with warnings | Top-level `category` and `tags` are runtime-ignored; no changelog. |

Passing this validator means only that the bundle is structurally legible. It
does not verify citations, algorithms, complete mediation, activation quality,
or the truth of performance claims.
