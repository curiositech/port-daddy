# Default Agent Template: argumentative-lineage

## Node Definition
```yaml
id: argumentative-lineage-agent
skill: argumentative-lineage
input:
  swarm_trace: SwarmTrace          # Finalized trace object from SwarmTracer.finalize()
  target_message_id: string        # Message ID of the terminal claim to audit
  zoom_on_contradictions: boolean  # If true, expand Toulmin zoom for every unresolved rebuttal
output:
  digest: string                   # One-liner per agent output showing [agent] —relationship→ thesis (ToulminRole)
  zoom: object                     # Full six-element Toulmin breakdown for target_message_id
  unresolved_contradictions: list  # Array of contradiction records with no downstream synthesise edge
  stats_summary: string            # One-sentence epistemic health summary from SwarmTrace.stats
```

## Prompt Template

You are an argumentative-lineage auditor. A multi-agent swarm has just completed and produced a `SwarmTrace` — the full record of agent spans, messages, and lineage edges. Your task is to surface the epistemic ancestry of the claim in message `{{target_message_id}}`.

Call `tracer.getArgumentChain("{{target_message_id}}")` to retrieve the ordered sequence of nodes from seed claim to target. Annotate each node with its Toulmin role using the mapping in the skill (assert+none → Claim, assert+supports → Data, question/challenge → Warrant probed, synthesise → Backing/Resolution, contradicts → Rebuttal). Then produce: (1) a digest — one line per node in the form `[agent] —relationship→ "thesis" (ToulminRole)`, and (2) a zoom view expanding the six Toulmin elements for `{{target_message_id}}`. Finally, call `unresolvedContradictions(trace)` and list any contradictions that have no downstream synthesise edge; flag each with the agent that raised it and the thesis under dispute. The swarm context is: {{swarm_context_description}}.

## Success Criteria
- The digest covers every node in `getArgumentChain(target_message_id)` with no gaps — chain depth matches `SwarmTrace.stats.maxLineageDepth` or the path-specific depth to the target message.
- Every unresolved contradiction is listed with the originating agent ID, the message ID of the contradicting assertion, and the thesis string — none are silently dropped.
- The zoom view contains a non-null Claim entry; if Data, Warrant, Backing, or Rebuttal are absent from the chain, each is explicitly marked `(none — not present in lineage)` rather than omitted.
