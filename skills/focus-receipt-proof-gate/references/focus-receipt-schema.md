# Focus Receipt Schema

Use this when drafting or reviewing a "current product focus receipt," or when checking a milestone chapter's Goal/Tasks/Gate structure before agents are launched against it.

## Where this comes from

`docs/architecture/agent-harbor-technical-binder/18-build-prescription-agent-launch-board.md` names one canonical "Current product focus receipt" — the one place the binder answers "what do we build next, what waits, how many agents do we launch, and what proof makes a slice done." Chapter `07-milestones-and-work-dag.md` supplies the companion rule for every individual milestone: **"Every milestone should produce a visible user artifact and a test."**

A focus receipt is not a status update and not a vibe. It is the specific, checkable claim that makes an agent launch legitimate instead of decorative.

## The twelve fields, field by field

| Field | What it answers | Failure mode this skill catches |
| --- | --- | --- |
| `decision` | The one thing being built/prioritized right now. | Blank or generic ("improve the product"). |
| `now` | The narrow, concrete slice being executed immediately. | A whole milestone instead of a slice; unbounded scope. |
| `whyNow` | Why this beats every other candidate at this moment. | No comparison to alternatives — reads as "because we felt like it." |
| `evidence` | The observed fact (operator complaint, failed probe, incident) that justifies `whyNow`. | An assertion with nothing underneath it. |
| `notNow` | Explicit scope deliberately excluded. | Silent scope creep later — "we assumed that was included." |
| `cutSuspend` | Concepts/verbs/panels being frozen or removed. | Old and new truths kept alive in parallel (chapter 18: "do not let old dispatch/sortie/spawn concepts keep independent runtime state"). |
| `firstVisibleProof` | The exact observable artifact that proves the decision produced something real. | Missing → `no-first-visible-proof` (critical). This is the "we'll know it when we see it" failure. |
| `acceptanceGate` | The concrete, checkable claim the proof must satisfy, plus whether it is provable from daemon truth. | Missing statement → `receipt-missing-required-field`. Not daemon-testable → `acceptance-gate-not-daemon-testable` (see `references/proof-gate-vs-cached-state.md`). |
| `killRevisitTrigger` | The exact condition under which this decision is paused and re-litigated. | Missing → `no-kill-trigger` (critical). A decision with an entry condition and no exit condition is half a decision. |
| `contextSwitchCount` | How many independent chains/foundations this decision spans. | Not scored directly, but see the "Agent count rule" below — high switch counts before a contract freeze predict incompatible schemas. |
| `agentsNeeded` | How many agents this decision launches, and in what wave. | Same as above — not scored directly, but should track the Agent count rule. |
| `owner` | The named role or person accountable for the decision. | Missing → `receipt-missing-required-field`. |
| `reviewDate` | The date this decision must be revisited with fresh evidence. | Missing → `receipt-missing-required-field`. Elapsed → `review-date-elapsed` (high) — chapter 18 is explicit that "this is the prescription until the next focus receipt revises it with evidence," which requires an actual revisit, not an indefinitely stale one. |

`scripts/focus_receipt_audit.mjs` scores `decision`, `now`, `whyNow`, `evidence`, `owner`, `reviewDate`, and `acceptanceGate.statement` as one generic required-field check; `firstVisibleProof`, `killRevisitTrigger`, and `acceptanceGate.testableAgainstDaemonTruth` each get their own named finding because they are the three fields agents most often skip while still sounding decisive. `notNow`, `cutSuspend`, `contextSwitchCount`, and `agentsNeeded` are accepted and encouraged but not currently scored — they describe scope and staffing, not testability.

## Milestone Goal/Tasks/Gate discipline

Every milestone chapter (`07-milestones-and-work-dag.md`) follows the same three-part shape, and a focus receipt should be checkable against the milestone it serves:

- **Goal** — one sentence naming what becomes true.
- **Tasks** — the concrete work items, not aspirations.
- **Gate** — the specific, observable conditions that must hold before the milestone counts as done (e.g. Milestone 2's gate: "one compliant local Codex Agent Node; one compliant local Claude Code Agent Node; ... app displays compliance and failed checks").

A `firstVisibleProof` that doesn't map to at least one line in the milestone's Gate is a sign the receipt was written independently of the binder rather than as an instance of it.

## The Agent count rule

Chapter 18 fixes a specific staffing shape for the first execution wave: one contract-freeze agent alone, then a fixed fanout, with later chains explicitly held back:

> "1 agent now: F0 contract freeze. Then 6 agents: C1, C2, C3, C5, C8, I0. Hold C4/C6/C7/C9 until F0 is done and at least one local Agent Node emits real events."

The reasoning given is symmetric and worth restating when reviewing `contextSwitchCount`/`agentsNeeded`: "More agents before contract freeze will create incompatible schemas and duplicate state machines," but "after F0, ledger, adapters, UI, governance, setup, and integration can advance mostly independently if they obey the same contracts." A receipt that proposes a large fanout before its own contract-freeze step exists is repeating the mistake the binder was written to prevent.
