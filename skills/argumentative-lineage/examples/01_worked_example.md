# Worked Example: Security Review Swarm

A security swarm evaluates a proposed API key rotation policy. Three agents — `RiskAnalyst`, `ComplianceChecker`, and `Synthesiser` — run in parallel. The operator needs to know why the final synthesis concluded "rotation every 90 days is insufficient" and which agent first raised the claim.

## Step-by-Step

**Step 1 — Wrap the executor and run the swarm.**

```ts
const tracer = new SwarmTracer('key-rotation-review');
const tracedExecutor = tracer.wrapExecutor(baseAgentExecutor);

const result = await executeSwarm(config, {
  agentExecutor: tracedExecutor,
  onMessage: (msg) => tracer.recordMessage(msg),
});

const trace = tracer.finalize(result.convergenceReason, config.agents);
// trace.stats: { contradictionCount: 1, synthesisCount: 1, maxLineageDepth: 3 }
```

**Step 2 — Pull the argument chain for the synthesis message.**

```ts
const synthMsgId = 'msg-007'; // Synthesiser's final output
const chain = tracer.getArgumentChain(synthMsgId);
```

Raw chain returned (3 nodes, seed first):

```
[
  { messageId: 'msg-001', agent: 'RiskAnalyst',      act: 'assert',    relationship: 'none',        thesis: '90-day rotation leaves keys exposed for 2,160 hours — unacceptable for PCI scope.' },
  { messageId: 'msg-004', agent: 'ComplianceChecker', act: 'challenge', relationship: 'contradicts', thesis: 'NIST SP 800-57 does not mandate sub-90-day rotation; risk framing is vendor-driven.' },
  { messageId: 'msg-007', agent: 'Synthesiser',       act: 'synthesise', relationship: 'qualifies',  thesis: '90-day rotation insufficient without compensating controls (monitoring, short-lived tokens).' },
]
```

**Step 3 — Annotate Toulmin roles.**

```ts
const annotated = annotateArgumentChain(tracer, synthMsgId);
```

| Node | Toulmin Role | Agent |
|---|---|---|
| msg-001 | Claim | RiskAnalyst |
| msg-004 | Rebuttal | ComplianceChecker |
| msg-007 | Backing/Resolution | Synthesiser |

**Step 4 — Check for unresolved contradictions.**

```ts
const unresolved = unresolvedContradictions(trace);
// [] — msg-004 contradicts msg-001, but msg-007 synthesises both. Clean.
```

## Expected Output

`digestWithZoom(trace, 'msg-007')` produces:

```
DIGEST:
[RiskAnalyst]      —none→        "90-day rotation leaves keys exposed..."  (Claim)
[ComplianceChecker] —contradicts→ "NIST SP 800-57 does not mandate..."     (Rebuttal)
[Synthesiser]      —qualifies→   "90-day insufficient without controls"    (Backing/Resolution)

ZOOM (msg-007):
  Claim:   RiskAnalyst — "90-day rotation unacceptable for PCI scope"
  Data:    (none — claim was asserted without supporting data nodes)
  Rebuttal: ComplianceChecker — "NIST does not mandate sub-90-day"
  Backing: Synthesiser — resolved via qualification
```

## Failure Modes

**1. Claim has no data nodes — the Warrant is implicit and untested.**
`RiskAnalyst` asserted the seed claim without a supporting `act: "assert" + relationship: "supports"` message. The digest shows `Data: (none)`. Flag this: the "2,160 hours" figure is asserted, not derived. Remediation: re-prompt `RiskAnalyst` with `"Provide a source or derivation for your exposure estimate"` and record the response as a new `supports` edge before finalising.

**2. `getArgumentChain` returns only 1 node — lineage is not propagating.**
This usually means agents published messages without setting `discourse.relationship`. Check that `tracer.recordMessage()` is called on every published message (not just the seed). If messages bypass `onMessage`, their `LineageEdge` records are never written and `traceLineage()` hits a dead end after the first hop.
