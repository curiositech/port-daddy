# Example Output: Focus Receipt & Proof Gate

Scenario: an agent wants to launch three GPUI agents on the Harbor Editor collaborative pane this week. It writes a `decision` and a `now` line, points at "the panel shows the file being edited" as its acceptance gate, and hands the chain a work order that only names an input. This is the "sounds like a decision, isn't testable" receipt `focus_receipt_audit.mjs` is designed to catch.

## Weak receipt — input

```json
{
  "receipt": {
    "decision": "Ship the Harbor Editor collaborative pane.",
    "now": "Launch three GPUI agents on cooperative editing this week.",
    "whyNow": "",
    "evidence": "",
    "firstVisibleProof": "",
    "acceptanceGate": {
      "statement": "The control panel shows the file being edited.",
      "testableAgainstDaemonTruth": false
    },
    "killRevisitTrigger": "",
    "owner": "",
    "reviewDate": "2026-05-01"
  },
  "workOrder": {
    "input": "the binder",
    "output": "",
    "owner": "",
    "proofGate": ""
  }
}
```

## Weak receipt — audit result

```json
{
  "pass": false,
  "score": 8,
  "findings": [
    { "severity": "critical", "id": "receipt-missing-required-field", "message": "Focus receipt is missing required field \"whyNow\"." },
    { "severity": "critical", "id": "receipt-missing-required-field", "message": "Focus receipt is missing required field \"evidence\"." },
    { "severity": "critical", "id": "receipt-missing-required-field", "message": "Focus receipt is missing required field \"owner\"." },
    { "severity": "critical", "id": "no-first-visible-proof", "message": "Focus receipt names no First Visible Proof — no observable artifact that proves the decision produced something real." },
    { "severity": "critical", "id": "no-kill-trigger", "message": "Focus receipt names no Kill/Revisit Trigger — no condition under which this decision is paused or re-litigated." },
    { "severity": "critical", "id": "acceptance-gate-not-daemon-testable", "message": "Acceptance gate is not marked testable against daemon truth — it may only prove a cached UI state, not what the backend actually did." },
    { "severity": "high", "id": "review-date-elapsed", "message": "Focus receipt's reviewDate (\"2026-05-01\") has passed — this decision has not been revisited with evidence since." },
    { "severity": "critical", "id": "placeholder-not-launch", "message": "Work order cannot state \"output\", \"owner\", \"proofGate\" — per the binder's own rule, a chain that cannot state its input, output, owner, and proof gate is a planning placeholder, not an agent launch." }
  ],
  "recommendations": [
    "Add a real, non-empty \"whyNow\" to the focus receipt — an absent field is a placeholder, not a decision.",
    "Add a real, non-empty \"evidence\" to the focus receipt — an absent field is a placeholder, not a decision.",
    "Add a real, non-empty \"owner\" to the focus receipt — an absent field is a placeholder, not a decision.",
    "Name the exact user-visible artifact (a screen, a saved event, a passing probe) that will exist once this focus is real.",
    "Name the exact condition (e.g. \"if X cannot be made reliable\") that pauses this focus and forces a revisit.",
    "Rewrite the acceptance gate so it can be proven by rebuilding visible state from daemon/event truth after a restart or reconnect, and set testableAgainstDaemonTruth: true only when that is actually possible.",
    "Revisit the focus receipt: confirm the decision still holds with current evidence, or supersede it with a new receipt and a new reviewDate.",
    "State a real output/owner/proofGate before treating this as an agent launch, or keep it as a backlog idea, not a work order."
  ]
}
```

## What fixing it actually looked like

1. **Wrote `whyNow` and `evidence` for real**: "The pane is the only wedge that proves human+agent co-editing with governance (Milestone 9); no other milestone demonstrates claims-as-awareness-ranges" and "Two agents have already collided on the same file with no warning in manual testing."
2. **Named a First Visible Proof**: "A human opens a file in the native app, a second peer joins, and both edits are visible with an authorship gutter — per Milestone 9's gate."
3. **Named a Kill/Revisit Trigger**: "If claims-as-awareness-ranges cannot block an out-of-claim write within one sprint, suspend the editor wedge and return to read-only + Loro local buffer only."
4. **Rewrote the acceptance gate** from a UI description to a daemon-provable claim: "A killed agent's out-of-claim edits are recoverable from the daemon's op log after the app is restarted," and set `testableAgainstDaemonTruth: true` because that claim is checked by replaying the op log, not by reading the screen.
5. **Filled in the owner** ("Harbor Editor wedge lead") and picked a `reviewDate` in the future.
6. **Completed the work order**: named the real `output` (a working read-only pane + Loro buffer + claim gutter), the chain `owner`, and the `proofGate` (Milestone 9's own gate bullets: local edit persists, second peer joins, out-of-claim write blocked or shadowed, killed agent's edits recoverable).

## Fixed receipt — input

This is `examples/sample-input.json`, unmodified — the binder's own flagship focus receipt and Work Order F0, transcribed field-for-field from chapter 18:

```json
{
  "receipt": {
    "decision": "Build the official Agent Node control plane, starting with contract truth and transcript truth.",
    "now": "F0 contract freeze, then a narrow C1/C2/C3/C5/C8 fanout that proves one local official Agent Node can be transcripted, probed, shown, and governed.",
    "whyNow": "The product will not feel real until the operator can see an agent's live and historical work, know whether it is compliant, and control only the actions Port Daddy can honestly govern.",
    "evidence": "The strongest repeated operator complaint is blank or hollow control surfaces: no transcript, no live stream, no files, no model/provider truth, no clear compliant versus non-compliant status, and no click-first controls.",
    "firstVisibleProof": "A local Codex or Claude Code body appears in pd-console as an Agent Node with provider/model tier, compliance level, live stream or explicit no-stream reason, saved transcript events, files touched, and controls gated by compliance level.",
    "acceptanceGate": {
      "statement": "The proof must survive relaunch from daemon truth, not from a cached UI model.",
      "testableAgainstDaemonTruth": true
    },
    "killRevisitTrigger": "If transcript ingestion cannot be made reliable for at least one local body, pause GPUI expansion and fix the adapter/transcript seam first.",
    "owner": "Harbor Architect of Record",
    "reviewDate": "2026-08-15"
  },
  "workOrder": {
    "input": "README.md, 03-agent-contract-and-extension-api.md, 09-data-model-and-api.md, 11-redteam-whitehat-cross-lens-review.md, 12-agent-work-chains-and-second-pass-review.md, 14-work-intake-and-node-shaping.md, 16-binder-architect-of-record.md",
    "output": "An ADR for Agent Run Saga and backend authority; versioned schemas for WorkIntent, WorkPlan, AgentNode, AgentRun, TranscriptEvent, ControlCommand, ComplianceProbeResult, CostAccrualEvent, WorkReceipt, and ContextEnvelope; a command/query/event boundary table; API versioning and tolerant-reader policy; a migration list for old launch paths.",
    "owner": "One senior architecture agent (Work Order F0).",
    "proofGate": "Every user action maps to a command, query, or event; the UI cannot fabricate runtime truth; transcript/control/cost/claim/receipt events are append-only; restart or reconnect can rebuild visible state from backend truth; old verbs are intake metadata, not runtime concepts."
  }
}
```

## Fixed receipt — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Focus receipt is real and its work order is launch-ready: every required field is stated, entry/exit criteria are named, the acceptance gate is daemon-testable, and the work order states input/output/owner/proof gate. Launch it."
  ]
}
```
