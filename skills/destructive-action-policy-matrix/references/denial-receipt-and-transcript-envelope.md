# Denial Receipt And Pre-Tool/Post-Tool Event Envelope

Use this when defining what actually gets emitted when a gated action is blocked or held — the shapes the C5 governance work order calls out by name: the pre-tool/post-tool event envelope, the human gate payload, and the denial receipt.

## Pre-tool and post-tool event envelope

Every gated action produces two possible envelope points:

- **Pre-tool**: fires *before* the tool call executes. This is the only point at which a `block`-tier action can be stopped with zero side effects — anything enforced post-tool has already run.
- **Post-tool**: fires *after* the tool call executes, for tool-result persistence and for `allow`-tier actions where no denial is possible but the action's outcome still needs a durable record.

Minimum envelope fields for either point:

```json
{
  "phase": "pre-tool",
  "actionName": "git reset --hard",
  "category": "git",
  "tier": "block",
  "decision": "denied",
  "timestamp": "2026-07-03T18:04:11Z",
  "sessionId": "<session-id>",
  "toolCallId": "<tool-call-id>"
}
```

`decision` is one of `denied`, `held` (approve-tier, awaiting a human), or `proceeded`. A `pre-tool` envelope with `decision: proceeded` for a `block`-tier action is a contradiction — if it proceeded, the gate did not actually block it.

## Human gate payload (approve-tier only)

When `decision: held`, the human gate payload is what a reviewer sees before deciding:

```json
{
  "actionName": "rm -rf outside worktree root",
  "category": "filesystem",
  "requestedBy": "<agent/session id>",
  "context": "<why the agent believes this is necessary, verbatim>",
  "blastRadius": "<what would be deleted/affected, computed not asserted>",
  "options": ["approve", "reject", "modify"]
}
```

`blastRadius` must be computed from the actual command/target (e.g. a real `find`/`git status --porcelain` preview), not restated from the agent's own claim about what it intends to do — the whole point of the gate is that the agent's self-report is not trusted. See `human-gate-designer` for the general shape of presenting a gate and routing the approve/reject/modify decision back into a DAG; this skill's job is proving the *policy classification and evidence* feeding that gate, not the review UX itself.

## Denial receipt shape

The denial receipt is the durable, machine-readable record a `denial-without-receipt` finding checks for. It is a specialization of the broader work-receipt concept (`agent-work-receipt-designer`) scoped to exactly one gate decision:

```json
{
  "kind": "denial-receipt",
  "actionName": "git reset --hard",
  "category": "git",
  "tier": "block",
  "decision": "denied",
  "reason": "Destructive git action attempted against a dirty worktree.",
  "safeAlternative": "git stash push -m \"<reason>\" (or git checkout -- <path> for a scoped revert)",
  "sideEffectFree": true,
  "transcriptEventId": "<id of the recorded transcript event>",
  "timestamp": "2026-07-03T18:04:11Z"
}
```

Three fields are critical and map directly to the audit's critical findings:

- `sideEffectFree: true` must be *proven* by a negative fixture, not asserted — this is what `sideEffectFreeOnBlockFixture` in the policy matrix records.
- `safeAlternative` must be a concrete, runnable next step, not "try something else."
- `transcriptEventId` must reference a real transcript event — a receipt that exists only in a log a human never sees does not satisfy `denial-without-transcript-event`.

## Never-contained bodies

An unmanaged or same-UID agent body (no sandbox boundary, no separate OS user, no container) can emit a denial receipt just fine — the *policy* layer (this skill) and the *containment* layer (`sandboxed-adversarial-test-harness`) are independent. But such a body must never be marked `contained` in a report: containment requires an enforced isolation boundary that a same-UID process, by construction, does not have. The `same-uid-marked-contained` finding exists specifically to catch a report that conflates "we have a policy for this action" with "this body cannot escape the policy."
