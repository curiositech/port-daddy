# Agentic app architecture declaration

```json
{
  "appName":"[name]",
  "transparency":{"actionDisclosure":"summary","evidenceDisclosure":"summary","uncertaintyDisclosure":"summary","privateReasoningPolicy":"not-requested","interruptMode":"[not-applicable|before-dispatch|between-steps|mid-run]","rationale":"[scope]"},
  "stateModel":{"conversationTranscript":"[used|not-applicable]","durableTaskState":"[used|not-applicable]","userMemory":"[used|not-applicable]","provenanceEvidence":"[used|not-applicable]","retention":"[retention/deletion]","restoreForkPolicy":"[restore/fork/replay boundary]","rationale":"[scope]"},
  "contextStrategy":{"strategies":["bounded-input"],"rationale":"[workload basis]"},
  "capabilities":{"tools":"[used|not-applicable]","skills":"[used|not-applicable]","mcp":{"status":"not-applicable","rationale":"[scope]"},"secretCustody":{"required":false,"mode":"not-applicable","scope":"no secret reaches this app","rationale":"[scope]"},"rationale":"[capability boundary]"},
  "execution":{"agentType":"non-coding","effectClass":"none","isolation":"not-applicable","control":{"kind":"not-applicable","rationale":"no effect is declared"},"authority":"no effect authority","receiptPolicy":"record static audit only","rationale":"[effect scope]"}
}
```

Record implementation evidence separately from this declaration. A static pass is not an enforcement or deployment result.
