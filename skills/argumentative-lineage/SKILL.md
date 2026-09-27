---
name: argumentative-lineage
version: 0.1.0
description: >
  Track the full Toulmin epistemic ancestry of every claim produced by a multi-agent swarm.
  Each agent output is tagged with an argument chain (claim / data / warrant / relationship)
  derived from SwarmTracer spans and LineageEdge records, so operators can zoom into any
  sub-claim and see precisely which agents asserted it, what triggered each assertion, and
  how contradictions propagated or were synthesised away. The SwarmTracer pattern — wrapping
  the SwarmAgentExecutor to capture spans, record messages, and build a lineage graph — is
  the concrete runtime substrate. Argumentative lineage lifts that graph into the Toulmin
  vocabulary so reasoning provenance is both machine-queryable and human-interpretable.
author: soma-windags-graft
tags:
  - argumentation
  - toulmin
  - swarm
  - provenance
  - lineage
  - multi-agent
  - epistemic-transparency
pairs-with:
  - toulmin-argument-analysis
  - dag-execution-tracer
  - swarm-discourse-coordinator
  - logical-fallacy-detector
---

# Argumentative Lineage

## When to Use

- You are running a WinDAGs swarm (or any multi-agent discourse topology) and need to audit
  **why** the final synthesis reached a particular conclusion — not just what it said.
- An operator or reviewer asks "which agent first claimed X, and what triggered it?" — i.e.,
  they need reasoning provenance, not just output.
- You are building a swarm where conflicting agent claims must be traceable: legal analysis,
  security review, medical triage, policy evaluation, or any domain where "show your work"
  is a compliance or trust requirement.

NOT for:
- Single-agent, single-turn outputs where there is no discourse graph to traverse.
- Data pipeline lineage (column-to-column provenance) — use `data-lineage-tracker` instead.
- Debugging swarm execution failures or hangs — use `dag-execution-tracer` or `dag-failure-analyzer`.

## Core Concepts

**SwarmSpan** — One agent processing one triggering message. Recorded by `SwarmTracer.wrapExecutor()`.
Carries: `spanId`, `agentId`, `skillId`, `triggerMessageId`, `producedMessageIds`, `durationMs`,
`promptHash`, `outputHash`, `discourse[]`, `status`. Every span is the unit of argumentative work.

**LineageEdge** — A directed edge `fromMessageId → toMessageId` through `agentId` and `spanId`,
optionally labelled with a `SwarmDiscourse` relationship (`supports`, `contradicts`, `qualifies`,
`synthesises`). The lineage graph is the raw substrate; the Toulmin layer annotates it with claim /
data / warrant semantics.

**Argument Chain** — The output of `SwarmTracer.getArgumentChain(messageId)`: an ordered sequence
of `{ messageId, agent, act, relationship, thesis }` tuples from the seed message to the target,
extracted by walking `traceLineage()` and filtering for messages that carry discourse metadata.
This is the machine-readable form of Toulmin lineage.

**Toulmin Annotation Layer** — Maps `SwarmDiscourse` fields onto Toulmin roles:
- `act: "assert"` + `relationship: "supports"` → **Data** (grounds for an upstream claim)
- `act: "assert"` + `relationship: "none"` on the seed → **Claim** (root thesis)
- `act: "question" / "challenge"` → surfaces the **Warrant** (implicit bridge being probed)
- `act: "synthesise"` → **Backing** or resolution of a qualifier / rebuttal branch
- `relationship: "contradicts"` → **Rebuttal** candidate requiring resolution or qualification

**Digest-with-Zoom** — A two-level presentation pattern: (1) a one-line digest per agent output
showing `[agent] —[relationship]→ thesis` for rapid scanning, and (2) a zoom view for any
sub-claim that expands the full six-element Toulmin breakdown and traces lineage back to the seed.
Enables operators to stay at altitude until a specific claim needs scrutiny.

## Implementation Pattern

```
// 1. Instantiate tracer before swarm execution
const tracer = new SwarmTracer('my-swarm-name');

// 2. Wrap the agent executor — all spans captured automatically
const tracedExecutor = tracer.wrapExecutor(baseAgentExecutor);

// 3. Run the swarm, routing every published message through recordMessage()
const result = await executeSwarm(config, {
  agentExecutor: tracedExecutor,
  onMessage: (msg) => tracer.recordMessage(msg),
});

// 4. Finalize to get the complete SwarmTrace
const trace = tracer.finalize(result.convergenceReason, config.agents);

// 5. Annotate argument chain for any terminal message
function annotateArgumentChain(tracer, messageId) {
  const chain = tracer.getArgumentChain(messageId);
  // chain is Array<{ messageId, agent, act, relationship, thesis }>

  return chain.map((node, i) => {
    const toulminRole =
      i === 0                              ? 'Claim'
      : node.relationship === 'supports'   ? 'Data'
      : node.relationship === 'contradicts'? 'Rebuttal'
      : node.act === 'synthesise'          ? 'Backing/Resolution'
      : node.act === 'question'            ? 'Warrant (probed)'
      :                                      'Qualifier';

    return { ...node, toulminRole };
  });
}

// 6. Digest-with-zoom: render a scannable one-liner per agent output
function digestWithZoom(trace, targetMessageId) {
  const chain = annotateArgumentChain(tracer, targetMessageId);

  // DIGEST — one line per node
  const digest = chain.map(n =>
    `[${n.agent}] —${n.relationship}→ "${n.thesis}" (${n.toulminRole})`
  ).join('\n');

  // ZOOM — full Toulmin expansion of the target message
  const claim   = chain.find(n => n.toulminRole === 'Claim');
  const data    = chain.filter(n => n.toulminRole === 'Data');
  const warrant = chain.find(n => n.toulminRole === 'Warrant (probed)');
  const backing = chain.filter(n => n.toulminRole === 'Backing/Resolution');
  const rebuttal = chain.filter(n => n.toulminRole === 'Rebuttal');

  return { digest, zoom: { claim, data, warrant, backing, rebuttal } };
}

// 7. Contradiction audit — find unresolved rebuttals
function unresolvedContradictions(trace) {
  const contradictions = tracer.findContradictions();
  const synthesisIds = new Set(
    trace.messages
      .filter(m => m.discourse?.act === 'synthesise')
      .flatMap(m => tracer.impactAnalysis(m.id).map(d => d.id))
  );
  return contradictions.filter(c => !synthesisIds.has(c.message.id));
}
```

Key method signatures from `swarm-tracer.ts`:
- `new SwarmTracer(swarmName: string, traceId?: string)`
- `tracer.wrapExecutor(executor: (agent, triggeringMessage, allMessages) => Promise<publications[]>)`
- `tracer.recordMessage(message: SwarmMessage): void`
- `tracer.finalize(convergenceReason: string, agents: SwarmAgent[]): SwarmTrace`
- `tracer.traceLineage(messageId: string): SwarmMessage[]` — ancestors in causal order, seed first
- `tracer.getArgumentChain(messageId: string): Array<{ messageId, agent, act, relationship, thesis }>`
- `tracer.findContradictions(): Array<{ message, contradicts, thesis }>`
- `tracer.impactAnalysis(messageId: string): SwarmMessage[]` — downstream messages

`SwarmTrace.stats` carries `contradictionCount`, `synthesisCount`, `maxLineageDepth`,
`discourseRelationshipCounts` — use these for a fast epistemic health summary before diving
into individual chains.

## Key References

1. Toulmin, S. (1958). *The Uses of Argument*. Cambridge University Press. — Foundational
   six-element model (Claim / Data / Warrant / Backing / Qualifier / Rebuttal) that this
   skill projects onto swarm discourse graphs.

2. `workgroup-ai/packages/core/src/topologies/swarm-tracer.ts` — Source implementation.
   `SwarmTracer`, `SwarmSpan`, `LineageEdge`, `SwarmTrace`, `SwarmTraceStats` interfaces
   and all query methods cited above live here. Read before extending.

3. Dung, P.M. (1995). "On the Acceptability of Arguments and its Fundamental Role in
   Nonmonotonic Reasoning, Logic Programming and n-Person Games." *Artificial Intelligence*
   77(2): 321–357. — Argumentation frameworks; relevant when modelling `contradicts` edges
   as attack relations and `synthesise` edges as defeat/reinstatement.

4. `windags/skills/toulmin-argument-analysis/SKILL.md` — Companion skill for single-argument
   Toulmin analysis. Use argumentative-lineage when the argument spans multiple agent turns;
   use toulmin-argument-analysis when auditing a single agent's output in isolation.
