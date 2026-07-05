# Audience Stories And Port Daddy Opportunities

Use this when turning research into product requirements.

## Audience Segments

### Solo Founder / Product Builder

- Job: turn a vague idea into a working app without getting trapped in setup.
- Craves: zero-state start, visible progress, one-click preview, cheap iteration, rollback.
- Pain: fragile generated code, hidden deployment state, no sense of what changed.
- Story: As a solo founder, I want an agent to build a previewable slice with an inspectable diff and rollback receipt so I can iterate without becoming an accidental release engineer.

### Staff Engineer / Tech Lead

- Job: delegate boring but risky work while preserving architecture and review standards.
- Craves: file ownership, plan review, tests, PR thread replies, stale-context detection.
- Pain: agents produce broad diffs, miss invariants, and leave cleanup tax.
- Story: As a tech lead, I want each agent task to declare scope, constraints, validation, and unresolved risk so I can review intent before diff volume.

### Enterprise Admin / Security Owner

- Job: let teams use agents without leaking secrets, violating policy, or losing auditability.
- Craves: managed rules, model allowlists, MCP allowlists, spend caps, sandboxing, audit logs.
- Pain: local agent tools can run commands, fetch packages, or expose tokens.
- Story: As an admin, I want agent actions tied to identity, policy, and durable logs so I can approve adoption without depending on every developer's judgment.

### OSS Maintainer

- Job: triage issues and PRs without drowning in low-quality agent submissions.
- Craves: dedupe, reproduction proof, focused diffs, review-thread engagement, CI evidence.
- Pain: duplicate PRs, unreviewed generated code, no meaningful responder.
- Story: As a maintainer, I want agent-authored PRs to carry a machine-readable receipt so I can reject low-proof work quickly and merge high-proof work confidently.

### Agent Power User

- Job: run several agents across worktrees while keeping control.
- Craves: swarm board, claims, locks, transcripts, budget, kill switch, result comparison.
- Pain: agents collide, go stale, pick incompatible models, or vanish without salvage.
- Story: As a power user, I want to launch a named swarm with roles, worktree isolation, and live receipts so parallel work feels coordinated rather than chaotic.

## Port Daddy Opportunity Map

| Opportunity | Why Port Daddy can own it | Proof required |
| --- | --- | --- |
| Agent Harbor control plane | Port Daddy already has sessions, claims, notes, salvage, tubes, actors, spend, and PR finish-line culture. | Launch, inspect, pause, salvage, and review several agents from one operator surface. |
| Cross-tool receipt standard | Every tool emits different logs; Port Daddy can normalize tasks into transcripts, commands, tests, diffs, and PR state. | A receipt can answer "what changed, why, by whom, with what validation" across Claude/Codex/Cursor-like backends. |
| Swarm collision prevention | Existing claims/worktrees/locks map directly to multi-agent pain. | Two agents trying the same file produce a visible conflict and suggested route, not silent overwrite. |
| Spend and model compatibility | Local spawn failure showed the need for account-compatible model selection and crisp failure. | Spawn preflight catches unsupported models, missing auth, and budget before launch. |
| Agent training/eval lab | Port Daddy can record trajectories and replay them in sandboxes. | A behavior curriculum turns transcripts into eval rows and rejects regressions before deployment. |

## Research Caveats

- Vendor docs describe intended behavior, not actual reliability.
- Social posts overrepresent power users, anger, and novelty.
- Benchmarks underrepresent repo-specific taste, review norms, security posture, and maintainability.
- Product claims shift quickly; verify docs and pricing before shipping public claims.
