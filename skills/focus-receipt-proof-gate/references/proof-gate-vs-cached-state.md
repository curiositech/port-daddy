# Proof Gate vs. Cached State

Use this when writing or trusting an acceptance gate, or when deciding whether a proposed agent chain is a real work order or a planning placeholder.

## The daemon-truth rule

Chapter 18's own acceptance gate for its flagship focus receipt is a template for every other gate in the binder:

> "Acceptance gate: The proof must survive relaunch from daemon truth, not from a cached UI model."

This is not a stylistic preference. It is the direct consequence of the binder's data-model shibboleths (chapter 18, "Data model shibboleths"):

- "The event log is sacred; projections are disposable."
- "Commands decide; queries display; events record what happened."
- "A UI pane can be stale, but a tool gate cannot be authorized from stale data."
- "Transcript absence is data, not emptiness."

A UI can legitimately be stale for a moment. An acceptance gate cannot be — because an acceptance gate is the thing that tells a human or another agent "this is real, build on it." If the gate can be satisfied by a cached, optimistic, or client-side-only state, then "restart the daemon and reconnect" becomes a hidden regression test nobody ran. `testableAgainstDaemonTruth: true` on `receipt.acceptanceGate` is a claim that the gate survives exactly that restart-and-rebuild test — set it to `true` only when it actually does.

### What "daemon truth" looks like in practice

The chapter's own worked acceptance gates for the C1–C8 work orders are the pattern to copy:

- C1 (event ledger): "projections rebuild from scratch; duplicate events are idempotent; unknown schema fields are tolerated; stale views are labeled and never used for command authorization."
- C2 (adapter compliance probes): "forged compliance is downgraded; observed agents cannot receive C2+ controls."
- C3 (operator control panel): "missing transcript shows exact cause and remediation; controls are enabled only when compliance supports them."
- C5 (governance and tool gates): "the denial is visible in transcript and Work Receipt."

Every one of these is phrased as a claim about backend/event state that can be re-derived after a crash, not about what currently renders on a screen.

### What fails this test

- "The dashboard shows the agent as compliant." (What happens after a hard refresh with the daemon still starting up?)
- "The user reported it worked." (Not reproducible from any system-of-record.)
- "It passed in the demo." (A demo is a single observed run, not a rebuildable claim.)

## Planning placeholder vs. agent launch

The companion rule from the same chapter governs the work order a receipt hands to an agent:

> "If a proposed chain cannot state its input, output, owner, and proof gate, it is a planning placeholder, not an agent launch."

Read the chapter's own Work Order F0 as the reference shape: explicit `Inputs` (a named list of binder chapters), explicit `Outputs` (an ADR, ten named versioned schemas, a command/query/event boundary table, an API versioning policy, a migration list), an explicit `Send:` line naming who does it, and explicit `Acceptance gates:` (four falsifiable bullet points). Compare that to a chain described only as "launch an agent to work on governance" — no named input, no named artifact as output, no accountable owner, no way to know when it's done. That sentence is a wish, not a work order, no matter how urgent it sounds.

`scripts/focus_receipt_audit.mjs` treats this as symmetric to the acceptance-gate check: `placeholder-not-launch` fires (critical) listing exactly which of `input` / `output` / `owner` / `proofGate` is missing, so the fix is always "state the specific missing thing," never "trust the vibe of the ask."

## Why both checks are fail-closed

Both checks default to "not safe" rather than "safe unless proven otherwise":

- `acceptanceGate.testableAgainstDaemonTruth` must be the literal boolean `true`. Absent, `false`, or any other value is treated as *not* daemon-testable — an unset field is not evidence of safety, it is evidence nobody checked.
- Work-order fields are checked for presence as non-empty strings, not merely "the key exists." An empty string is exactly as much of a placeholder as a missing key.

This mirrors the binder's own posture: it does not ask "has anything gone visibly wrong yet?" — it asks "can this specific claim be proven against the system of record?" A receipt or work order that cannot answer that is treated as a placeholder even if nothing about it looks obviously broken.
