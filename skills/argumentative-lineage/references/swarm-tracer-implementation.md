# WinDAGs SwarmTracer: Argumentative Lineage via Execution Spans

`SwarmTracer` in `windags/topologies/swarm-tracer.ts` is the observability layer for multi-agent swarm discourse. It wraps the `SwarmAgentExecutor` function (typed as `(agent, triggeringMessage, allMessages) => Promise<Publication[]>`) and intercepts every agent execution to build a complete causal graph of who said what, in response to what, with what discourse relationship.

## Core Data Model

Each agent execution becomes a `SwarmSpan`. The span captures: `agentId`, `skillId`, `modelTier`, `triggerMessageId`, `triggerChannel`, `producedMessageIds[]`, monotonic `startOffsetMs` and `durationMs` (both via `performance.now()`), `promptChars`/`outputChars`, `promptHash`/`outputHash` (non-cryptographic djb2-style hash of first 500 chars), `contextMessageCount`, and the `SwarmDiscourse[]` from produced publications.

Lineage is a flat edge list: `LineageEdge { fromMessageId, toMessageId, agentId, spanId, discourse? }`. Two edges may be emitted per produced message: one from `span.triggerMessageId → newMessage.id`, and a second from `discourse.respondingTo → newMessage.id` when `respondingTo` differs from the trigger. This double-edge correctly captures cases where an agent was subscribed to channel A but its discourse explicitly responds to a prior message from channel B.

The `SwarmDiscourse` type (defined in `swarm.ts`) carries the argumentative metadata: `act` (FIPA-inspired: `inform | propose | counter | refine | synthesize | query`), `respondingTo` (the single message ID this is a direct response to), `relationship` (`supports | contradicts | extends | narrows | synthesizes`), and `thesis` (one-sentence core claim). There is no explicit `confidence`, `warrant_type`, or `evidence_ids` field in the current type — these are the responsibility of the agent's skill output payload, not the discourse envelope. The `thesis` field is the closest analogue to a claim summary; agents embed warrant reasoning and evidence references in the message `payload`.

## Usage Pattern

```typescript
const tracer = new SwarmTracer('competitive-intel');
const tracedExecutor = tracer.wrapExecutor(agentExecutor);

const result = await executeSwarm(config, {
  agentExecutor: tracedExecutor,
  onMessage: (msg) => tracer.recordMessage(msg),
});

const trace = tracer.finalize(result.convergenceReason, config.agents);
```

`wrapExecutor` returns a function with the same signature as the original executor. It mutates the span in-place after `await executor(...)` resolves — meaning `producedMessageIds` is empty during execution and only filled on completion. `recordMessage` must be called from `onMessage` to register messages and close the lineage edges; without it, `producedMessageIds` stays empty and lineage is never built.

## Query Methods

`traceLineage(messageId)` returns all ancestor messages in causal order via backward DFS on the edge list. Cycle-safe via `visited` set. `getArgumentChain(messageId)` filters those to discourse-bearing messages and returns `{messageId, agent, act, relationship, thesis}[]` — the direct input for argumentative-lineage analysis. `findContradictions()` scans all messages for `relationship === 'contradicts'` and pairs them with their target. `impactAnalysis(messageId)` does forward DFS: all downstream messages that exist because of a given message.

`SwarmTraceStats` (computed on `finalize`) includes `maxLineageDepth` (BFS from seed message using fixpoint iteration), `contradictionCount`, `synthesisCount`, and per-agent execution counts. These are the primary health metrics for swarm discourse quality.

## Key Points
- The argumentative chain is reconstructed from the flat `lineage: LineageEdge[]` via backward DFS — not stored as a tree. This means any message can serve as a query root.
- `SwarmDiscourse.respondingTo` is the pivot field: it creates a second lineage edge when it differs from the execution trigger, capturing cross-channel discourse references.
- Confidence scores, warrant types, and evidence IDs are payload-level concerns, not discourse-envelope concerns — the skill output must embed them in `payload`; the tracer does not standardize them.
- `promptHash` and `outputHash` use only the first 500 chars of serialized content — sufficient for deduplication detection but not collision-resistant.
- Seed messages (`sourceAgentId === '__seed__'`) are excluded from span linkage in `recordMessage`; they are the lineage roots.

## See Also
- `windags/topologies/swarm.ts` — `SwarmDiscourse`, `SwarmMessage`, and `createMessage` factory
- `argumentative-lineage/SKILL.md` — how the skill uses `getArgumentChain()` to evaluate argument structure quality
- `argumentative-lineage/diagrams/01_flowchart_decision-points.md` — decision flowchart for lineage evaluation
