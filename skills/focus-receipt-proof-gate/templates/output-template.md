# Focus Receipt Template

Fill in every field before treating this as a real decision. Validate it with `node scripts/focus_receipt_audit.mjs --input <this-as-json>.json` before launching any agent against it.

```markdown
## Current product focus receipt

Decision:
  <The one thing being built/prioritized right now.>

Now:
  <The narrow, concrete slice being executed immediately.>

Why now:
  <Why this beats every other candidate at this moment.>

Evidence:
  <The observed fact — complaint, failed probe, incident — that justifies "Why now.">

Not now:
  - <Scope deliberately excluded, item 1>
  - <Scope deliberately excluded, item 2>

Cut/suspend:
  <Concepts/verbs/panels being frozen or removed so work doesn't fork into parallel truths.>

First visible proof:
  <The exact observable artifact — screen, saved event, passing probe — that proves this is real.>

Acceptance gate:
  <The concrete, checkable claim the proof must satisfy.>
  Testable against daemon truth: <true — only if it survives a restart/reconnect rebuild, never a cached UI model>

Kill/revisit trigger:
  <The exact condition that pauses this decision and forces a revisit.>

Context switch count:
  <How many independent chains/foundations this decision spans.>

Agents needed:
  <How many agents this decision launches, and in what wave.>

Owner:
  <Named role or person accountable for this decision.>

Review date:
  <ISO-8601 date this decision must be revisited with fresh evidence.>
```

## Work order template

One of these per agent chain the receipt launches. A chain missing any of the four fields below is a planning placeholder, not an agent launch.

```markdown
### Work Order <id> - <short name>

Input:
  <What the agent reads/consumes before starting.>

Output:
  <What the agent must produce.>

Owner:
  <Who is accountable for this chain's output.>

Proof gate:
  <The concrete acceptance gate(s) this chain's output must pass before it counts as done.>
```

## Checklist before launching any agent

- [ ] `decision`, `now`, `whyNow`, `evidence`, `owner`, `reviewDate` are all real, non-empty statements — not placeholders.
- [ ] `firstVisibleProof` names a specific observable artifact, not a vague outcome.
- [ ] `killRevisitTrigger` names a specific condition, symmetric to `firstVisibleProof`.
- [ ] `acceptanceGate.statement` is a concrete, checkable claim, and `testableAgainstDaemonTruth` is `true` only if it survives a daemon restart/reconnect rebuild.
- [ ] Every work order this receipt launches states `input`, `output`, `owner`, and `proofGate` explicitly.
- [ ] `reviewDate` is in the future; if it has passed, this receipt needs a revisit before anything launches against it.
